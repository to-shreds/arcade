(function (root) {
  'use strict';
  function sentenceStart(prefix) {
    return /^[\s“"'(\[]*$/.test(prefix) || /[.!?][”"')\]]*\s+[“"'(\[]*$/.test(prefix);
  }
  function format(value, type, atStart) {
    var text = String(value || '');
    var named = type === 'name' || type === 'place' || type === 'person';
    // A character prompt also accepts ordinary descriptions such as "your uncle".
    if (type === 'person' && /^(?:a|an|the|my|your|our|his|her|their|this|that|you|we|everyone)\b/i.test(text)) named = false;
    if (!named) {
      text = text.toLowerCase().replace(/\bi\b/g, 'I');
    }
    if (atStart) text = text.replace(/[A-Za-z]/, function (letter) { return letter.toUpperCase(); });
    return text;
  }
  function render(template, values, prompts, escapeHtml) {
    var plain = '', previous = 0;
    var html = template.replace(/\{(\d+)\}/g, function (match, indexText, offset) {
      plain += template.slice(previous, offset);
      var index = parseInt(indexText, 10);
      var type = (prompts[index] || [])[0];
      var value = format(values[index], type, sentenceStart(plain) || (type === 'exclamation' && /[“"]\s*$/.test(plain)));
      plain += value;
      previous = offset + match.length;
      return '<span class="filled-word">' + escapeHtml(value) + '</span>';
    });
    return html;
  }
  root.ArcadeMadLibsCase = { format: format, render: render };
})(typeof window === 'undefined' ? globalThis : window);
