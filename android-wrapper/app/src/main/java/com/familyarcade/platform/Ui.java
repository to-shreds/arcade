package com.familyarcade.platform;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class Ui {
    public static final int BG = Color.rgb(9, 13, 30);
    public static final int PANEL = Color.rgb(20, 26, 51);
    public static final int TEXT = Color.WHITE;
    public static final int MUTED = Color.rgb(174, 185, 219);
    public static final int GOLD = Color.rgb(255, 206, 58);
    public static final int CYAN = Color.rgb(33, 220, 255);
    public static final int RED = Color.rgb(255, 92, 112);
    public static final int GREEN = Color.rgb(95, 232, 125);

    private Ui() {}

    public static int dp(Context context, float value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    public static GradientDrawable background(int color, int stroke, int radius, Context context) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(context, radius));
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(context, 1), stroke);
        return drawable;
    }

    public static TextView text(Context context, String value, float size, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    public static Button button(Context context, String value) {
        Button button = new Button(context);
        button.setText(value);
        button.setTextColor(TEXT);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setMinHeight(dp(context, 42));
        button.setMinimumHeight(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(context, 12), dp(context, 6), dp(context, 12), dp(context, 6));
        button.setBackground(background(Color.rgb(35, 45, 77), Color.rgb(75, 89, 132), 12, context));
        return button;
    }

    public static EditText input(Context context, String hint) {
        EditText edit = new EditText(context);
        edit.setTextColor(TEXT);
        edit.setHintTextColor(Color.rgb(120, 133, 170));
        edit.setHint(hint);
        edit.setTextSize(15);
        edit.setSingleLine(true);
        edit.setPadding(dp(context, 12), dp(context, 9), dp(context, 12), dp(context, 9));
        edit.setBackground(background(Color.rgb(14, 19, 42), Color.rgb(68, 81, 123), 11, context));
        return edit;
    }

    public static LinearLayout row(Context context) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, 0, 0, dp(context, 7));
        return row;
    }

    public static LinearLayout.LayoutParams weight(float value) {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, value);
    }

    public static LinearLayout.LayoutParams gap(Context context) {
        return new LinearLayout.LayoutParams(dp(context, 7), 1);
    }

    public static TextView title(Context context, String value) {
        TextView title = text(context, value, 24, GOLD, true);
        title.setPadding(0, dp(context, 4), 0, dp(context, 8));
        return title;
    }

    public static TextView label(Context context, String value) {
        TextView label = text(context, value, 12, MUTED, true);
        label.setPadding(dp(context, 2), dp(context, 8), 0, dp(context, 4));
        return label;
    }

    public static void margins(View view, int left, int top, int right, int bottom, Context context) {
        ViewGroup.LayoutParams current = view.getLayoutParams();
        if (!(current instanceof ViewGroup.MarginLayoutParams)) return;
        ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) current;
        params.setMargins(dp(context, left), dp(context, top), dp(context, right), dp(context, bottom));
        view.setLayoutParams(params);
    }
}
