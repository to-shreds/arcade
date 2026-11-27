using System.Text.Json;
using Arcade.Windows.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arcade.Windows;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        using var package = File.OpenRead(args.Single());
        using var snapshot = new ChildSnapshot(package);
        using var form = new Form { ClientSize = new Size(960, 650) };
        using var view = new WebView2 { Dock = DockStyle.Fill };
        form.Controls.Add(view);
        using var watchdog = new System.Windows.Forms.Timer { Interval = 90_000 };
        int result = 1;
        watchdog.Tick += (_, _) =>
        {
            Console.Error.WriteLine("WebView2 smoke test exceeded 90 seconds.");
            form.Close();
        };
        form.Shown += async (_, _) =>
        {
            watchdog.Start();
            try
            {
                await ExerciseAsync(view, snapshot);
                result = 0;
            }
            catch (Exception failure)
            {
                Console.Error.WriteLine(failure);
            }
            form.Close();
        };
        Application.Run(form);
        return result;
    }

    private static async Task ExerciseAsync(WebView2 view, ChildSnapshot snapshot)
    {
        var game = snapshot.Policy.Activities.First(activity => activity.Id == "math");
        var allowed = new HashSet<string>(StringComparer.Ordinal) { game.Id };
        var profile = Path.Combine(Path.GetTempPath(), "arcade-smoke-" + Guid.NewGuid().ToString("N"));
        var core = await new ChildWebView(snapshot, () => allowed).InitializeAsync(view, profile);
        var origin = ChildSnapshot.Origin;
        int passed = 0;

        void Check(bool result, string step)
        {
            if (!result) throw new InvalidOperationException(step);
            Console.WriteLine("PASS " + step);
            passed++;
        }

        async Task NavigateAsync(string url)
        {
            var complete = new TaskCompletionSource<bool>();
            void OnComplete(object? sender, CoreWebView2NavigationCompletedEventArgs args) =>
                complete.TrySetResult(args.IsSuccess);
            core.NavigationCompleted += OnComplete;
            try
            {
                core.Navigate(url);
                Check(await complete.Task.WaitAsync(TimeSpan.FromSeconds(20)), "navigation " + url);
            }
            finally
            {
                core.NavigationCompleted -= OnComplete;
            }
        }

        async Task<bool> TestAsync(string expression)
        {
            string answer = await core.ExecuteScriptAsync(expression);
            return answer == "true";
        }

        await NavigateAsync(ChildSnapshot.HomeUri);
        Check(await TestAsync("document.querySelectorAll('main li').length === 1"), "one allowed activity displayed");
        Check(await TestAsync("ArcadeWindowsChild && typeof RTCPeerConnection === 'undefined' && " +
            "typeof WebSocket === 'undefined' && typeof WebTransport === 'undefined'"), "peer networking and socket APIs unavailable");
        Check(await TestAsync("typeof showOpenFilePicker === 'undefined'") &&
            !core.Settings.IsWebMessageEnabled && !core.Settings.AreHostObjectsAllowed,
            "no file system picker capability or privileged native bridge");
        bool messageDelivered = false;
        core.WebMessageReceived += (_, _) => messageDelivered = true;
        await core.ExecuteScriptAsync("try { window.chrome?.webview?.postMessage('smoke'); } catch {}");
        await Task.Delay(100);
        Check(!messageDelivered, "a page cannot deliver a native message");
        string uri = $"{origin}/{game.Entry}";
        await NavigateAsync(uri);
        Check(await TestAsync("typeof ArcadeSave === 'object' && typeof ArcadeSharedActivity === 'undefined'"),
            "canonical activity and saves load with shared play disabled");
        Check(await TestAsync("localStorage.setItem('arcade.smoke','ok'); localStorage.getItem('arcade.smoke') === 'ok'"),
            "local storage works on packaged origin");

        const string responseProbe = """
            (() => {
              const attempts = [
                fetch('/arcade-save.js').then(response => response.status),
                fetch('/arcade-save.js', {method: 'POST'}).then(response => response.status),
                fetch('/tv/index.html').then(response => response.status),
                fetch('http://127.0.0.1:7982/private-control').then(() => 'allowed', () => 'rejected'),
                Promise.resolve().then(() => navigator.serviceWorker.register('/sw.js')).then(() => 'allowed', () => 'rejected')
              ];
              Promise.all(attempts).then(outcomes => document.documentElement.dataset.arcadeProbe = JSON.stringify(outcomes));
              return true;
            })()
            """;
        Check(await TestAsync(responseProbe), "resource and worker probes started");
        string? outcomes = null;
        for (var attempt = 0; attempt < 40 && outcomes is null; attempt++)
        {
            using var state = JsonDocument.Parse(await core.ExecuteScriptAsync("document.documentElement.dataset.arcadeProbe"));
            if (state.RootElement.ValueKind == JsonValueKind.String) outcomes = state.RootElement.GetString();
            if (outcomes is null) await Task.Delay(100);
        }
        Check(outcomes == """[200,403,403,"rejected","rejected"]""", "asset, blocked method, blocked activity, loopback and worker: " + outcomes);

        Check(await TestAsync("""
            const iframe = document.createElement('iframe');
            iframe.src = '/balloons/index.html';
            document.body.append(iframe);
            window.open('https://example.com');
            true;
            """), "iframe and popup probes dispatched");
        await Task.Delay(500);
        Check(await TestAsync("document.querySelector('iframe').contentDocument?.URL !== location.origin + '/balloons/index.html'"),
            "embedded documents blocked");
        Check(core.Source == uri, "popup did not navigate the WebView");

        core.Navigate($"{origin}/tv/index.html");
        await Task.Delay(250);
        Check(core.Source == uri, "direct unapproved path blocked");
        core.Navigate("https://example.com/");
        await Task.Delay(250);
        Check(core.Source == uri, "external navigation blocked");
        allowed.Clear();
        await NavigateAsync(ChildSnapshot.HomeUri);
        core.Navigate(uri);
        await Task.Delay(250);
        Check(core.Source == ChildSnapshot.HomeUri, "a revoked activity cannot be reentered");

        foreach (string id in new[] { "encyclopedia", "dictionary" })
        {
            var reference = snapshot.Policy.Activities.FirstOrDefault(activity => activity.Id == id);
            if (reference is null) continue;
            allowed.Add(id);
            await NavigateAsync($"{origin}/{reference.Entry}");
            string index = id == "encyclopedia" ? "articles" : "words";
            await core.ExecuteScriptAsync($"fetch('/reference/packs/{index}.json')" +
                ".then(response => response.json()).then(data => document.documentElement.dataset.pack = String(data.schema))");
            bool found = false;
            for (var attempt = 0; attempt < 40 && !found; attempt++)
            {
                found = await TestAsync("document.documentElement.dataset.pack === '1'");
                if (!found) await Task.Delay(100);
            }
            Check(found, "curated reference index loaded locally for " + id);
        }
        Console.WriteLine($"{passed} real WebView2 assertions passed.");
    }
}
