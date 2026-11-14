# AM PC Remote - native Windows input host
# Persistent helper process. Reads one JSON request per line on stdin and writes
# one JSON response per line on stdout. Runs only on Windows.
#
# Protocol: {"id": 1, "cmd": "key", "vk": 13, "mods": [17]}
# Reply:    {"id": 1, "ok": true, "result": ...}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class AmNative
{
    // ---------- SendInput ----------
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx; public int dy; public uint mouseData; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint MOUSEEVENTF_HWHEEL = 0x1000;
    const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    static extern void SetProcessDPIAware();

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("user32.dll")]
    static extern bool LockWorkStation();

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    [DllImport("kernel32.dll")]
    static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);

    [DllImport("kernel32.dll")]
    static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX status);

    [DllImport("kernel32.dll")]
    static extern bool GetSystemPowerStatus(ref SYSTEM_POWER_STATUS status);

    [DllImport("kernel32.dll")]
    static extern ulong GetTickCount64();

    [StructLayout(LayoutKind.Sequential)]
    struct FILETIME { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength; public uint dwMemoryLoad;
        public ulong ullTotalPhys; public ulong ullAvailPhys;
        public ulong ullTotalPageFile; public ulong ullAvailPageFile;
        public ulong ullTotalVirtual; public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent;
        public byte Reserved1; public int BatteryLifeTime; public int BatteryFullLifeTime;
    }

    static ulong PrevIdle, PrevKernel, PrevUser;
    static bool HaveCpu;

    public static void Init() { SetProcessDPIAware(); }

    static void Send(INPUT input)
    {
        INPUT[] arr = new INPUT[1];
        arr[0] = input;
        SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    static INPUT KeyInput(ushort vk, ushort scan, uint flags)
    {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.U.ki.wVk = vk;
        i.U.ki.wScan = scan;
        i.U.ki.dwFlags = flags;
        return i;
    }

    public static void Key(ushort vk, bool down)
    {
        Send(KeyInput(vk, 0, down ? 0u : KEYEVENTF_KEYUP));
    }

    public static void KeyTap(ushort vk)
    {
        Send(KeyInput(vk, 0, 0));
        Thread.Sleep(18);
        Send(KeyInput(vk, 0, KEYEVENTF_KEYUP));
    }

    public static void Combo(ushort[] mods, ushort vk)
    {
        if (mods != null) foreach (ushort m in mods) { Send(KeyInput(m, 0, 0)); Thread.Sleep(12); }
        Send(KeyInput(vk, 0, 0));
        Thread.Sleep(24);
        Send(KeyInput(vk, 0, KEYEVENTF_KEYUP));
        if (mods != null)
        {
            for (int i = mods.Length - 1; i >= 0; i--)
            { Send(KeyInput(mods[i], 0, KEYEVENTF_KEYUP)); Thread.Sleep(12); }
        }
    }

    public static void TypeText(string text)
    {
        if (text == null) return;
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (c == '\r') continue;
            if (c == '\n') { KeyTap(13); continue; }
            if (c == '\t') { KeyTap(9); continue; }
            INPUT down = KeyInput(0, (ushort)c, KEYEVENTF_UNICODE);
            INPUT up = KeyInput(0, (ushort)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
            Send(down); Send(up);
            if ((i & 15) == 15) Thread.Sleep(2);
        }
    }

    public static void MouseMove(int dx, int dy)
    {
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dx = dx; i.U.mi.dy = dy; i.U.mi.dwFlags = MOUSEEVENTF_MOVE;
        Send(i);
    }

    public static void MouseMoveAbs(double x, double y)
    {
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dx = (int)Math.Round(x * 65535.0);
        i.U.mi.dy = (int)Math.Round(y * 65535.0);
        i.U.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
        Send(i);
    }

    public static void MouseButton(string button, bool down)
    {
        uint flag;
        if (button == "right") flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
        else if (button == "middle") flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
        else flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.dwFlags = flag;
        Send(i);
    }

    public static void Wheel(int delta, bool horizontal)
    {
        INPUT i = new INPUT();
        i.type = INPUT_MOUSE;
        i.U.mi.mouseData = (uint)delta;
        i.U.mi.dwFlags = horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL;
        Send(i);
    }

    // ---------- system status ----------
    public static object Status()
    {
        double cpu = 0;
        FILETIME idle, kernel, user;
        if (GetSystemTimes(out idle, out kernel, out user))
        {
            ulong i = ((ulong)idle.High << 32) | idle.Low;
            ulong k = ((ulong)kernel.High << 32) | kernel.Low;
            ulong u = ((ulong)user.High << 32) | user.Low;
            if (HaveCpu)
            {
                ulong di = i - PrevIdle;
                ulong dt = (k - PrevKernel) + (u - PrevUser);
                if (dt > 0) cpu = (1.0 - ((double)di / (double)dt)) * 100.0;
            }
            PrevIdle = i; PrevKernel = k; PrevUser = u; HaveCpu = true;
        }

        MEMORYSTATUSEX mem = new MEMORYSTATUSEX();
        mem.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        GlobalMemoryStatusEx(ref mem);

        SYSTEM_POWER_STATUS power = new SYSTEM_POWER_STATUS();
        bool hasBattery = GetSystemPowerStatus(ref power) && power.BatteryFlag != 128 && power.BatteryLifePercent != 255;

        string title = "";
        string procName = "";
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd != IntPtr.Zero)
        {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hwnd, sb, sb.Capacity);
            title = sb.ToString();
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            try { procName = Process.GetProcessById((int)pid).ProcessName; } catch { }
        }

        double idleSec = -1;
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (GetLastInputInfo(ref lii))
            idleSec = Math.Round((GetTickCount64() - lii.dwTime) / 1000.0, 1);

        return new Dictionary<string, object>
        {
            { "cpu", Math.Round(cpu, 1) },
            { "mem", Math.Round((double)mem.dwMemoryLoad, 1) },
            { "memTotalMb", (long)(mem.ullTotalPhys / 1048576UL) },
            { "memFreeMb", (long)(mem.ullAvailPhys / 1048576UL) },
            { "battery", hasBattery ? (int)power.BatteryLifePercent : -1 },
            { "charging", hasBattery && (power.BatteryFlag & 8) == 8 },
            { "ac", hasBattery && power.ACLineStatus == 1 },
            { "window", title },
            { "process", procName },
            { "idleSec", idleSec },
            { "volume", VolumeGet() },
            { "muted", VolumeMuted() },
            { "time", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") },
            { "uptimeSec", (long)(GetTickCount64() / 1000UL) }
        };
    }

    public static List<object> TopProcesses(int count)
    {
        var rows = new List<Dictionary<string, object>>();
        foreach (Process p in Process.GetProcesses())
        {
            try
            {
                rows.Add(new Dictionary<string, object>
                {
                    { "name", p.ProcessName },
                    { "pid", p.Id },
                    { "memMb", (long)(p.WorkingSet64 / 1048576L) },
                    { "cpu", (long)p.TotalProcessorTime.TotalMilliseconds }
                });
            }
            catch { }
        }
        rows.Sort(delegate(Dictionary<string, object> a, Dictionary<string, object> b)
        {
            return ((long)b["cpu"]).CompareTo((long)a["cpu"]);
        });

        var list = new List<object>();
        for (int i = 0; i < rows.Count && i < count; i++)
        {
            rows[i].Remove("cpu");
            list.Add(rows[i]);
        }
        return list;
    }

    // ---------- volume (Core Audio) ----------
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
            [MarshalAs(UnmanagedType.IUnknown)] out object interfacePtr);
        int OpenPropertyStore(int access, out IntPtr properties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint count);
        int SetMasterVolumeLevel(float level, Guid context);
        int SetMasterVolumeLevelScalar(float level, Guid context);
        int GetMasterVolumeLevel(out float level);
        int GetMasterVolumeLevelScalar(out float level);
        int GetChannelVolumeLevel(uint channel, out float level);
        int SetChannelVolumeLevel(uint channel, float level, Guid context);
        int SetChannelVolumeLevelScalar(uint channel, float level, Guid context);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        int GetVolumeStepInfo(out uint step, out uint stepCount);
        int VolumeStepUp(Guid context);
        int VolumeStepDown(Guid context);
        int QueryHardwareSupport(out uint mask);
        int GetVolumeRange(out float min, out float max, out float inc);
    }

    static IAudioEndpointVolume _volume;

    static IAudioEndpointVolume Vol()
    {
        if (_volume != null) return _volume;
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice dev;
        int hr = en.GetDefaultAudioEndpoint(0, 1, out dev);
        if (hr != 0) throw new COMException("No default audio endpoint", hr);
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object obj;
        hr = dev.Activate(ref iid, 23, IntPtr.Zero, out obj);
        if (hr != 0) throw new COMException("Cannot activate endpoint volume", hr);
        _volume = (IAudioEndpointVolume)obj;
        return _volume;
    }

    public static int VolumeGet()
    {
        try
        {
            float level;
            if (Vol().GetMasterVolumeLevelScalar(out level) == 0)
                return (int)Math.Round(level * 100.0);
        }
        catch { }
        return -1;
    }

    public static bool VolumeSet(int percent)
    {
        try
        {
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
            IAudioEndpointVolume v = Vol();
            Guid g = Guid.Empty;
            v.SetMasterVolumeLevelScalar((float)(percent / 100.0), g);
            if (percent > 0) v.SetMute(false, g);
            return true;
        }
        catch { return false; }
    }

    public static bool VolumeStep(int direction)
    {
        try
        {
            Guid g = Guid.Empty;
            if (direction > 0) Vol().VolumeStepUp(g); else Vol().VolumeStepDown(g);
            return true;
        }
        catch { return false; }
    }

    public static bool VolumeMuted()
    {
        try
        {
            bool muted;
            if (Vol().GetMute(out muted) == 0) return muted;
        }
        catch { }
        return false;
    }

    public static bool VolumeMute(bool? state)
    {
        try
        {
            bool target = state.HasValue ? state.Value : !VolumeMuted();
            Vol().SetMute(target, Guid.Empty);
            return true;
        }
        catch { return false; }
    }

    // ---------- power / desktop ----------
    public static bool MonitorOff()
    {
        SendMessage(new IntPtr(0xffff), 0x0112, new IntPtr(0xF170), new IntPtr(2));
        return true;
    }

    public static bool Lock() { return LockWorkStation(); }

    public static void Sleep()
    {
        Process.Start(new ProcessStartInfo("rundll32.exe", "powrprof.dll,SetSuspendState 0,1,0") { UseShellExecute = false });
    }

    public static void Shutdown(string mode)
    {
        string args = mode == "restart" ? "/r /t 0" : "/s /t 0";
        Process.Start(new ProcessStartInfo("shutdown.exe", args) { UseShellExecute = false });
    }

    // ---------- screenshot ----------
    public static string Screenshot(string path, int quality, int maxWidth)
    {
        Rectangle bounds = System.Windows.Forms.SystemInformation.VirtualScreen;
        using (Bitmap full = new Bitmap(bounds.Width, bounds.Height))
        {
            using (Graphics g = Graphics.FromImage(full))
                g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

            Bitmap output = full;
            if (maxWidth > 0 && full.Width > maxWidth)
            {
                int h = (int)Math.Round(full.Height * (maxWidth / (double)full.Width));
                output = new Bitmap(full, maxWidth, h);
            }

            ImageCodecInfo jpg = null;
            foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders())
                if (c.FormatID == ImageFormat.Jpeg.Guid) jpg = c;

            EncoderParameters ps = new EncoderParameters(1);
            ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
            if (jpg != null) output.Save(path, jpg, ps); else output.Save(path, ImageFormat.Jpeg);

            if (!object.ReferenceEquals(output, full)) output.Dispose();
        }
        return path;
    }

    // ---------- clipboard ----------
    public static string ClipboardGet()
    {
        try { return System.Windows.Forms.Clipboard.ContainsText() ? System.Windows.Forms.Clipboard.GetText() : ""; }
        catch { return ""; }
    }

    public static bool ClipboardSet(string text)
    {
        try { System.Windows.Forms.Clipboard.SetText(text ?? ""); return true; }
        catch { return false; }
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Windows.Forms, System.Drawing
[AmNative]::Init()

function Reply($id, $ok, $result, $errText) {
    $payload = @{ id = $id; ok = $ok }
    if ($ok) { $payload.result = $result } else { $payload.error = [string]$errText }
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 8))
    [Console]::Out.Flush()
}

[Console]::Out.WriteLine('{"event":"ready"}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }

    $id = $null
    $result = $null
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $cmd = [string]$req.cmd

        switch ($cmd) {
            'ping'       { $result = 'pong' }
            'key'        { if ($req.mods) { [AmNative]::Combo([int[]]$req.mods, [int]$req.vk) } else { [AmNative]::KeyTap([int]$req.vk) }; $result = $true }
            'keydown'    { [AmNative]::Key([int]$req.vk, $true); $result = $true }
            'keyup'      { [AmNative]::Key([int]$req.vk, $false); $result = $true }
            'type'       { [AmNative]::TypeText([string]$req.text); $result = $true }
            'move'       { [AmNative]::MouseMove([int]$req.dx, [int]$req.dy); $result = $true }
            'moveabs'    { [AmNative]::MouseMoveAbs([double]$req.x, [double]$req.y); $result = $true }
            'button'     { [AmNative]::MouseButton([string]$req.button, [bool]$req.down); $result = $true }
            'wheel'      { [AmNative]::Wheel([int]$req.delta, [bool]$req.horizontal); $result = $true }
            'volume'     {
                switch ([string]$req.op) {
                    'get'  { $result = @{ volume = [AmNative]::VolumeGet(); muted = [AmNative]::VolumeMuted() } }
                    'set'  { $result = [AmNative]::VolumeSet([int]$req.value) }
                    'up'   { $result = [AmNative]::VolumeStep(1) }
                    'down' { $result = [AmNative]::VolumeStep(-1) }
                    'mute' { if ($null -ne $req.value) { $result = [AmNative]::VolumeMute([bool]$req.value) } else { $result = [AmNative]::VolumeMute($null) } }
                }
            }
            'status'     { $result = [AmNative]::Status() }
            'procs'      { $result = [AmNative]::TopProcesses([int]$req.count) }
            'clipboard'  {
                if ([string]$req.op -eq 'set') { $result = @{ ok = [AmNative]::ClipboardSet([string]$req.text) } }
                else { $result = @{ text = [AmNative]::ClipboardGet() } }
            }
            'power'      {
                switch ([string]$req.mode) {
                    'lock'       { $result = [AmNative]::Lock() }
                    'monitoroff' { $result = [AmNative]::MonitorOff() }
                    'sleep'      { [AmNative]::Sleep(); $result = $true }
                    'restart'    { [AmNative]::Shutdown('restart'); $result = $true }
                    'shutdown'   { [AmNative]::Shutdown('shutdown'); $result = $true }
                }
            }
            'open' {
                Start-Process -FilePath ([string]$req.target) -ErrorAction Stop
                $result = $true
            }
            'screenshot' {
                $path = [string]$req.path
                $quality = if ($req.quality) { [int]$req.quality } else { 55 }
                $maxWidth = if ($req.maxWidth) { [int]$req.maxWidth } else { 1280 }
                $result = @{ path = [AmNative]::Screenshot($path, $quality, $maxWidth) }
            }
            default { throw "Unknown command: $cmd" }
        }

        Reply $id $true $result $null
    }
    catch {
        Reply $id $false $null $_.Exception.Message
    }
}
