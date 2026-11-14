package com.adiraimaji.ampcremote;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Small helpers so the activities can build a consistent dark UI in code. */
final class Ui {
    private Ui() {
    }

    static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static int color(Context context, int id) {
        return context.getColor(id);
    }

    static GradientDrawable background(Context context, int fill, int stroke, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(context, radiusDp));
        if (stroke != Color.TRANSPARENT) {
            drawable.setStroke(dp(context, 1), stroke);
        }
        return drawable;
    }

    static TextView text(Context context, CharSequence value, float sizeSp, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        view.setLineSpacing(dp(context, 2), 1f);
        return view;
    }

    static TextView label(Context context, CharSequence value) {
        return text(context, value, 12f, color(context, R.color.muted), false);
    }

    static TextView monospace(Context context, CharSequence value, float sizeSp) {
        TextView view = text(context, value, sizeSp, color(context, R.color.text), false);
        view.setTypeface(Typeface.MONOSPACE);
        return view;
    }

    static Button button(Context context, CharSequence label, boolean primary) {
        Button button = new Button(context);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15f);
        button.setTextColor(primary ? Color.WHITE : color(context, R.color.text));
        button.setBackground(background(
                context,
                primary ? color(context, R.color.accent) : color(context, R.color.surface_alt),
                primary ? color(context, R.color.accent) : color(context, R.color.border),
                12f));
        button.setPadding(dp(context, 16), dp(context, 10), dp(context, 16), dp(context, 10));
        button.setMinHeight(dp(context, 46));
        button.setGravity(Gravity.CENTER);
        return button;
    }

    static LinearLayout card(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14));
        layout.setBackground(background(context, color(context, R.color.surface), color(context, R.color.border), 16f));
        return layout;
    }

    static LinearLayout.LayoutParams lp(int width, int height) {
        return new LinearLayout.LayoutParams(width, height);
    }

    static LinearLayout.LayoutParams lp(int width, int height, float weight) {
        return new LinearLayout.LayoutParams(width, height, weight);
    }

    static LinearLayout.LayoutParams margins(ViewGroup.LayoutParams base, Context context,
                                               float left, float top, float right, float bottom) {
        LinearLayout.LayoutParams params = base instanceof LinearLayout.LayoutParams
                ? (LinearLayout.LayoutParams) base
                : new LinearLayout.LayoutParams(base.width, base.height);
        params.setMargins(dp(context, left), dp(context, top), dp(context, right), dp(context, bottom));
        return params;
    }

    static void gap(View view, Context context, int sizeDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, sizeDp));
        view.setLayoutParams(params);
    }

    static void toast(Context context, String message) {
        if (message == null || message.isEmpty()) return;
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }
}
