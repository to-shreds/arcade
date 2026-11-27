using System.Net;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Arcade.Windows.Core;

namespace Arcade.Windows;

internal sealed class ChildWebView(ChildSnapshot snapshot, Func<ISet<string>> approved)
{
    private const string ContentSecurity =
        "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; " +
        "frame-src 'none'; worker-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; connect-src 'self'";
    private const string Permissions =
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), " +
        "display-capture=(), clipboard-read=(), clipboard-write=(), local-fonts=(), web-share=(), " +
        "publickey-credentials-get=(), fullscreen=()";

    private const string StartupScript = """
        (() => {
          if (location.origin !== "https://arcade-child.invalid") return;
          Object.defineProperty(window, "ArcadeWindowsChild", { value: true });
          for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebSocket",
              "WebTransport", "EventSource", "showOpenFilePicker", "showDirectoryPicker", "showSaveFilePicker"]) {
            Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
          }
          if (window.SpeechSynthesis && window.speechSynthesis) {
            const prototype = window.SpeechSynthesis.prototype;
            const speak = prototype.speak;
            Object.defineProperty(prototype, "speak", {
              value(utterance) {
                if (!utterance.voice?.localService) {
                  const voices = this.getVoices().filter(voice => voice.localService);
                  const language = (utterance.lang || "en-US").toLowerCase();
                  utterance.voice = voices.find(voice => voice.lang.toLowerCase() === language) ??
                    voices.find(voice => voice.lang.toLowerCase().split("-")[0] === language.split("-")[0]) ?? null;
                }
                if (!utterance.voice?.localService) {
                  throw new DOMException("No matching installed voice is available.", "NotSupportedError");
                }
                return speak.call(this, utterance);
              }
            });
          }
        })();
        """;

    public async Task<CoreWebView2> InitializeAsync(WebView2 webView, string profile)
    {
        var options = new CoreWebView2EnvironmentOptions
        {
            AllowSingleSignOnUsingOSPrimaryAccount = false,
            ExclusiveUserDataFolderAccess = true,
            AdditionalBrowserArguments =
                "--disable-background-networking --disable-features=BackForwardCache " +
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"
        };
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile, options: options);
        await webView.EnsureCoreWebView2Async(environment);
        webView.AllowExternalDrop = false;
        var core = webView.CoreWebView2;
        var settings = core.Settings;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDefaultScriptDialogsEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.IsBuiltInErrorPageEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
          settings.IsReputationCheckingRequired = false;
        settings.IsStatusBarEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsWebMessageEnabled = false;
        core.Profile.IsPasswordAutosaveEnabled = false;
        core.Profile.IsGeneralAutofillEnabled = false;

        core.NavigationStarting += (_, args) => args.Cancel = snapshot.NavigationPath(args.Uri, approved()) is null;
        core.FrameNavigationStarting += (_, args) => args.Cancel = true;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.LaunchingExternalUriScheme += (_, args) => args.Cancel = true;
        core.DownloadStarting += (_, args) => { args.Cancel = true; args.Handled = true; };
        core.ContextMenuRequested += (_, args) => args.Handled = true;
        core.BasicAuthenticationRequested += (_, args) => args.Cancel = true;
        core.ClientCertificateRequested += (_, args) => args.Handled = true;
        core.ServerCertificateErrorDetected += (_, args) => args.Action = CoreWebView2ServerCertificateErrorAction.Cancel;
        core.PermissionRequested += (_, args) =>
        {
            args.State = CoreWebView2PermissionState.Deny;
            args.SavesInProfile = false;
            args.Handled = true;
        };

        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
            CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += (_, args) => Serve(environment, args);
        // Intercept the HTML file input's WebView native chooser independently of the page.
        await core.CallDevToolsProtocolMethodAsync("Page.setInterceptFileChooserDialog", """{"enabled":true,"cancel":true}""");
        await core.AddScriptToExecuteOnDocumentCreatedAsync(StartupScript);
        return core;
    }

    private void Serve(CoreWebView2Environment environment, CoreWebView2WebResourceRequestedEventArgs args)
    {
        try
        {
            var allowed = approved();
            string? path = args.Request.Method == "GET" ? snapshot.ResourcePath(args.Request.Uri, allowed) : null;
            if (path is null)
            {
                args.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Forbidden", "Cache-Control: no-store");
                return;
            }

            var contentType = ChildSnapshot.ContentType(path);
            MemoryStream contents = path == ChildSnapshot.Home ? BuildHome(allowed) : snapshot.Read(path);
            var headers = $"Content-Type: {contentType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n"
                + $"Referrer-Policy: no-referrer\r\nContent-Security-Policy: {ContentSecurity}\r\nPermissions-Policy: {Permissions}";
            args.Response = environment.CreateWebResourceResponse(contents, 200, "OK", headers);
        }
        catch (Exception error) when (error is IOException or InvalidDataException)
        {
            args.Response = environment.CreateWebResourceResponse(Stream.Null, 500, "Local asset unavailable", "Cache-Control: no-store");
        }
    }

    private MemoryStream BuildHome(ISet<string> allowed)
    {
        var html = new StringBuilder("""
            <!doctype html><html lang="en"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Family Arcade</title><style>
            :root{color-scheme:dark;font-family:system-ui;background:#090d1e;color:#ecf1ff}
            body{max-width:70rem;margin:0 auto;padding:1.4rem}
            h1{color:#ffce3a;margin:.2rem 0;font-size:clamp(1.8rem,7vw,3.5rem)}
            p{color:#c9d5f2}
            ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr));gap:.65rem;list-style:none;padding:0}
            a{display:flex;align-items:center;gap:.65rem;background:#161d39;border:1px solid #363f65;border-radius:.75rem;
             padding:.65rem;min-height:3rem;color:inherit;text-decoration:none;font-weight:700}
            a:hover,a:focus-visible{background:#273358;outline:2px solid #21dcff}
            img{width:2.5rem;height:2.5rem;object-fit:contain}
            </style></head><body><main><h1>Family Arcade</h1><p>Choose an activity.</p>
            """);
        var activities = snapshot.Policy.Activities.Where(activity => allowed.Contains(activity.Id))
            .OrderBy(activity => activity.Title, StringComparer.OrdinalIgnoreCase);
        html.Append("<ul>");
        foreach (var activity in activities)
        {
            html.Append("<li><a href=\"/").Append(WebUtility.HtmlEncode(activity.Entry))
                .Append("\"><img alt=\"\" src=\"/").Append(WebUtility.HtmlEncode(activity.Icon))
                .Append("\">").Append(WebUtility.HtmlEncode(activity.Title)).Append("</a></li>");
        }
        html.Append("</ul>");
        if (!activities.Any()) html.Append("<p>A grown-up can choose activities in Parent settings.</p>");
        html.Append("</main></body></html>");
        return new MemoryStream(Encoding.UTF8.GetBytes(html.ToString()), writable: false);
    }
}
