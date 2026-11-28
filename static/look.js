/* Fence Builder: the look (the colours) picked in Settings, Look and text size. It is kept on this computer only,
   and put on <html data-theme> before the page shows, so the page never flashes another look first.
   app.css has the colours of each look. The app, the sign-in page and the Accounts page all load this. */
(function () {
  var LOOKS = ['clean', 'warm', 'ranch', 'contrast', 'dark'], KEY = 'fb-look';
  // the top bar's colour, for the browser's own bar on phones
  var BAR = {clean: '#ffffff', warm: '#fbf8f1', ranch: '#3d3125', contrast: '#ffffff', dark: '#111316'};
  var root = document.documentElement;
  function apply(name) {
    if (LOOKS.indexOf(name) < 0) name = 'clean';
    root.setAttribute('data-theme', name);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', BAR[name]);
    return name;
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved);
  window.fbLook = {
    list: LOOKS,
    get: function () { return root.getAttribute('data-theme') || 'clean'; },
    set: function (name) {
      name = apply(name);
      try { localStorage.setItem(KEY, name); } catch (e) {}
      return name;
    }
  };
  // picked in another window of the app: follow it here too
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(e.newValue); });
})();
