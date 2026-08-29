package com.familyarcade.platform;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.Layout;
import android.util.AttributeSet;
import android.view.Gravity;
import android.widget.EditText;

public final class CodeEditText extends EditText {
    private final Paint numberPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dividerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private int gutter;

    public CodeEditText(Context context) {
        super(context);
        initialize();
    }

    public CodeEditText(Context context, AttributeSet attributes) {
        super(context, attributes);
        initialize();
    }

    private void initialize() {
        setTypeface(Typeface.MONOSPACE);
        setTextSize(13);
        setTextColor(Color.rgb(235, 240, 255));
        setHintTextColor(Color.rgb(105, 117, 151));
        setGravity(Gravity.TOP | Gravity.START);
        setHorizontallyScrolling(true);
        setSingleLine(false);
        setBackgroundColor(Color.rgb(8, 12, 27));
        numberPaint.setTypeface(Typeface.MONOSPACE);
        numberPaint.setTextSize(getTextSize() * .78f);
        numberPaint.setColor(Color.rgb(101, 115, 154));
        numberPaint.setTextAlign(Paint.Align.RIGHT);
        dividerPaint.setColor(Color.rgb(43, 55, 88));
        updateGutter();
    }

    private void updateGutter() {
        int lines = Math.max(1, getLineCount());
        int digits = String.valueOf(lines).length();
        gutter = Math.max(Ui.dp(getContext(), 42), Math.round(numberPaint.measureText(repeat('8', digits)) + Ui.dp(getContext(), 22)));
        setPadding(gutter, Ui.dp(getContext(), 10), Ui.dp(getContext(), 14), Ui.dp(getContext(), 20));
    }

    private String repeat(char value, int count) {
        StringBuilder result = new StringBuilder();
        while (count-- > 0) result.append(value);
        return result.toString();
    }

    @Override
    protected void onTextChanged(CharSequence text, int start, int lengthBefore, int lengthAfter) {
        super.onTextChanged(text, start, lengthBefore, lengthAfter);
        updateGutter();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        Layout layout = getLayout();
        if (layout != null) {
            int first = layout.getLineForVertical(getScrollY());
            int last = Math.min(layout.getLineCount() - 1, layout.getLineForVertical(getScrollY() + getHeight()));
            float x = gutter - Ui.dp(getContext(), 10);
            for (int line = first; line <= last; line++) {
                float y = getTotalPaddingTop() + layout.getLineBaseline(line) - getScrollY();
                canvas.drawText(String.valueOf(line + 1), x, y, numberPaint);
            }
            canvas.drawLine(gutter - Ui.dp(getContext(), 5), 0, gutter - Ui.dp(getContext(), 5), getHeight(), dividerPaint);
        }
        super.onDraw(canvas);
    }
}
