package com.adiraimaji.ampcremote;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** Editor for the Tasker / Locale action and condition plugin. */
public class TaskerEditActivity extends Activity {
    private final List<ServerInfo> servers = new ArrayList<>();
    private Spinner serverSpinner;
    private Spinner modeSpinner;
    private Spinner stateSpinner;
    private EditText commandField;
    private EditText pinField;
    private CheckBox broadcastBox;
    private LinearLayout commandGroup;
    private LinearLayout stateGroup;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        servers.addAll(ServerStore.get(this).all());
        setContentView(buildUi());
        loadExisting(getIntent().getBundleExtra(TaskerConfig.EXTRA_BUNDLE));
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.color(this, R.color.bg));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(20), dp(20), dp(22));
        scroll.addView(root, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = Ui.text(this, "AM PC Remote Action", 22, Ui.color(this, R.color.text), true);
        root.addView(title);
        TextView subtitle = Ui.text(this,
                "Choose a PC/server, then the command Tasker should send.",
                13, Ui.color(this, R.color.muted), false);
        subtitle.setPadding(0, dp(4), 0, dp(14));
        root.addView(subtitle);

        addLabel(root, "Mode");
        modeSpinner = spinner(new String[]{
                "Action - send a command",
                "Condition - is the PC online or paired?"
        });
        root.addView(modeSpinner, fullParams(0));

        addLabel(root, "Server");
        List<String> names = new ArrayList<>();
        names.add("First available server");
        for (ServerInfo info : servers) {
            names.add(info.name + "  (" + info.address() + ")");
        }
        serverSpinner = spinner(names.toArray(new String[0]));
        root.addView(serverSpinner, fullParams(0));

        commandGroup = new LinearLayout(this);
        commandGroup.setOrientation(LinearLayout.VERTICAL);
        addLabel(commandGroup, "Commands (one per line)");
        commandField = new EditText(this);
        commandField.setHint("next\nwait 1\ntext Hello from Tasker\nkey ctrl+s");
        commandField.setTextColor(Ui.color(this, R.color.text));
        commandField.setHintTextColor(Ui.color(this, R.color.muted));
        commandField.setTextSize(14);
        commandField.setTypeface(Typeface.MONOSPACE);
        commandField.setGravity(Gravity.TOP | Gravity.START);
        commandField.setMinLines(4);
        commandField.setMaxLines(12);
        commandField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        commandField.setPadding(dp(12), dp(10), dp(12), dp(10));
        commandField.setBackground(Ui.background(this, Ui.color(this, R.color.surface),
                Ui.color(this, R.color.border), 10));
        commandGroup.addView(commandField, fullParams(0));
        root.addView(commandGroup, fullParams(8));

        stateGroup = new LinearLayout(this);
        stateGroup.setOrientation(LinearLayout.VERTICAL);
        addLabel(stateGroup, "Condition is true when");
        stateSpinner = spinner(new String[]{
                "Online - the PC answers on the network",
                "Paired - this phone has a saved token"
        });
        stateGroup.addView(stateSpinner, fullParams(0));
        TextView stateNote = Ui.text(this,
                "The condition turns false while the PC is off or unreachable.",
                12, Ui.color(this, R.color.muted), false);
        stateNote.setPadding(0, dp(6), 0, 0);
        stateGroup.addView(stateNote);
        root.addView(stateGroup, fullParams(8));

        addLabel(root, "PIN (only needed if this phone is not paired yet)");
        pinField = new EditText(this);
        pinField.setHint("optional 6-digit PIN");
        pinField.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pinField.setSingleLine(true);
        pinField.setTextColor(Ui.color(this, R.color.text));
        pinField.setHintTextColor(Ui.color(this, R.color.muted));
        pinField.setTextSize(15);
        pinField.setPadding(dp(12), dp(10), dp(12), dp(10));
        pinField.setBackground(Ui.background(this, Ui.color(this, R.color.surface),
                Ui.color(this, R.color.border), 10));
        root.addView(pinField, fullParams(0));

        broadcastBox = new CheckBox(this);
        broadcastBox.setText("Broadcast the result");
        broadcastBox.setTextColor(Ui.color(this, R.color.text));
        broadcastBox.setTextSize(13.5f);
        broadcastBox.setChecked(true);
        LinearLayout.LayoutParams boxParams = fullParams(12);
        root.addView(broadcastBox, boxParams);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button cancel = Ui.button(this, "Cancel", false);
        cancel.setOnClickListener(v -> {
            setResult(RESULT_CANCELED);
            finish();
        });
        Button save = Ui.button(this, "Save", true);
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams left = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        left.setMargins(0, dp(12), dp(6), dp(10));
        LinearLayout.LayoutParams right = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        right.setMargins(dp(6), dp(12), 0, dp(10));
        buttons.addView(cancel, left);
        buttons.addView(save, right);
        root.addView(buttons);

        TextView help = Ui.monospace(this, CommandParser.helpText(), 11.5f);
        help.setTextColor(Ui.color(this, R.color.muted));
        help.setPadding(0, dp(6), 0, dp(6));
        root.addView(help);

        modeSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                applyMode();
            }

            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) {
                applyMode();
            }
        });
        applyMode();
        return scroll;
    }

    private void applyMode() {
        boolean condition = modeSpinner != null && modeSpinner.getSelectedItemPosition() == 1;
        if (commandGroup != null) commandGroup.setVisibility(condition ? View.GONE : View.VISIBLE);
        if (stateGroup != null) stateGroup.setVisibility(condition ? View.VISIBLE : View.GONE);
    }

    private void loadExisting(Bundle bundle) {
        if (bundle == null) return;
        String mode = bundle.getString(TaskerConfig.KEY_MODE, TaskerConfig.MODE_ACTION);
        modeSpinner.setSelection(TaskerConfig.MODE_CONDITION.equals(mode) ? 1 : 0);
        String command = bundle.getString(TaskerConfig.KEY_COMMAND, "");
        commandField.setText(command);
        String pin = bundle.getString(TaskerConfig.KEY_PIN, "");
        pinField.setText(pin);
        broadcastBox.setChecked(bundle.getBoolean(TaskerConfig.KEY_BROADCAST, true));
        String state = bundle.getString(TaskerConfig.KEY_STATE, "online");
        stateSpinner.setSelection("paired".equalsIgnoreCase(state) ? 1 : 0);

        String key = bundle.getString(TaskerConfig.KEY_SERVER, "");
        for (int i = 0; i < servers.size(); i++) {
            if (servers.get(i).key().equals(key)) {
                serverSpinner.setSelection(i + 1);
                break;
            }
        }
        applyMode();
    }

    private void save() {
        boolean condition = modeSpinner.getSelectedItemPosition() == 1;
        String command = commandField.getText().toString().trim();
        String state = stateSpinner.getSelectedItemPosition() == 1 ? "paired" : "online";

        if (!condition) {
            if (command.isEmpty()) {
                Ui.toast(this, "Enter a command such as next, mute or text Hello.");
                return;
            }
            try {
                CommandParser.parseScript(command);
            } catch (Exception error) {
                Ui.toast(this, error.getMessage());
                return;
            }
        }

        int index = serverSpinner.getSelectedItemPosition();
        String serverKey = "";
        String serverName = "";
        if (index > 0 && index - 1 < servers.size()) {
            ServerInfo info = servers.get(index - 1);
            serverKey = info.key();
            serverName = info.name;
        }

        Bundle bundle = new Bundle();
        bundle.putString(TaskerConfig.KEY_MODE, condition ? TaskerConfig.MODE_CONDITION : TaskerConfig.MODE_ACTION);
        bundle.putString(TaskerConfig.KEY_SERVER, serverKey);
        bundle.putString(TaskerConfig.KEY_COMMAND, condition ? "" : command);
        bundle.putString(TaskerConfig.KEY_STATE, state);
        bundle.putString(TaskerConfig.KEY_PIN, pinField.getText().toString().trim());
        bundle.putBoolean(TaskerConfig.KEY_BROADCAST, broadcastBox.isChecked());

        Intent result = new Intent();
        result.putExtra(TaskerConfig.EXTRA_BUNDLE, bundle);
        result.putExtra(TaskerConfig.EXTRA_STRING_BLURB,
                TaskerConfig.blurb(condition ? TaskerConfig.MODE_CONDITION : TaskerConfig.MODE_ACTION,
                        serverName, command, state));
        setResult(RESULT_OK, result);
        finish();
    }

    private Spinner spinner(String[] entries) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,
                android.R.layout.simple_spinner_item, entries) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getView(position, convertView, parent);
                view.setTextColor(Ui.color(TaskerEditActivity.this, R.color.text));
                view.setTextSize(14);
                return view;
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView view = (TextView) super.getDropDownView(position, convertView, parent);
                view.setTextColor(Ui.color(TaskerEditActivity.this, R.color.text));
                view.setBackgroundColor(Ui.color(TaskerEditActivity.this, R.color.surface));
                view.setTextSize(14);
                view.setPadding(dp(14), dp(10), dp(14), dp(10));
                return view;
            }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setBackground(Ui.background(this, Ui.color(this, R.color.surface),
                Ui.color(this, R.color.border), 10));
        spinner.setPadding(dp(10), dp(4), dp(10), dp(4));
        return spinner;
    }

    private void addLabel(LinearLayout parent, String text) {
        TextView label = Ui.label(this, text);
        label.setPadding(0, dp(12), 0, dp(5));
        parent.addView(label);
    }

    private LinearLayout.LayoutParams fullParams(int topDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(topDp), 0, 0);
        return params;
    }

    private int dp(float value) {
        return Ui.dp(this, value);
    }
}
