using Arcade.Windows.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Arcade.Windows;

internal sealed class ChildWindow : Form
{
    private readonly ChildSnapshot snapshot;
    private readonly string settingsPath;
    private readonly string profilePath;
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly Button home = PasswordDialogs.MakeButton("Home");
    private readonly Label message = new()
    {
        Dock = DockStyle.Fill, AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Visible = false
    };
    private readonly PasswordRetry retry = new();
    private ParentSettings settings;
    private HashSet<string> allowed;
    private bool canClose;

    public ChildWindow(ChildSnapshot snapshot, ParentSettings settings, string settingsPath, string profilePath)
    {
        this.snapshot = snapshot;
        this.settings = settings;
        this.settingsPath = settingsPath;
        this.profilePath = profilePath;
        allowed = settings.ApprovedActivityIds.ToHashSet(StringComparer.Ordinal);

        Text = "Family Arcade";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        MinimumSize = new Size(420, 300);
        BackColor = Color.FromArgb(32, 37, 52);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 11f);

        var bar = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, Padding = new Padding(8, 4, 8, 4)
        };
        var parent = PasswordDialogs.MakeButton("Parent settings");
        var exit = PasswordDialogs.MakeButton("Exit");
        home.Enabled = false;
        bar.Controls.AddRange([home, parent, exit]);

        var content = new Panel { Dock = DockStyle.Fill };
        content.Controls.Add(web);
        content.Controls.Add(message);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(bar, 0, 0);
        layout.Controls.Add(content, 0, 1);
        Controls.Add(layout);
        home.Click += (_, _) => GoHome();
        parent.Click += (_, _) => EditSettings();
        exit.Click += (_, _) => TryExit();
        Shown += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            var childWeb = new ChildWebView(snapshot, () => allowed);
            var core = await childWeb.InitializeAsync(web, profilePath);
            if (IsDisposed) return;
            core.ProcessFailed += (_, _) =>
            {
                if (!IsDisposed) ShowError("The Arcade view stopped. Exit and reopen Arcade.");
            };
            core.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess && args.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                    ShowError("This activity could not open. Press Home to return.");
            };
            home.Enabled = true;
            GoHome();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (!IsDisposed) ShowError("Microsoft Edge WebView2 Runtime is required. A grown-up can install it and reopen Arcade.");
        }
        catch (Exception error) when (error is InvalidOperationException or ArgumentException or
            System.Runtime.InteropServices.COMException or IOException or UnauthorizedAccessException)
        {
            if (!IsDisposed) ShowError("Arcade could not start its offline view. If reopening does not help, see the Windows instructions.");
        }
    }

    private void ShowError(string text)
    {
        web.Visible = false;
        message.Text = text;
        message.Visible = true;
        message.BringToFront();
    }

    private void GoHome()
    {
        if (!home.Enabled) return;
        message.Visible = false;
        web.Visible = true;
        web.CoreWebView2.Navigate(ChildSnapshot.HomeUri);
    }

    private void TryExit()
    {
        using var prompt = PasswordDialogs.VerifyPassword("Exit Arcade", settings.Password, retry);
        if (prompt.ShowDialog(this) != DialogResult.OK) return;
        canClose = true;
        Close();
    }

    private void EditSettings()
    {
        using var prompt = PasswordDialogs.VerifyPassword("Parent settings", settings.Password, retry);
        if (prompt.ShowDialog(this) != DialogResult.OK) return;
        using var editor = new SettingsDialog(snapshot.Policy.Activities, allowed, settings.Password);
        if (editor.ShowDialog(this) != DialogResult.OK) return;
        var updated = new ParentSettings(1, editor.Password, editor.ActivityIds);
        try
        {
            updated.Save(settingsPath);
            settings = updated;
            allowed = settings.ApprovedActivityIds.ToHashSet(StringComparer.Ordinal);
            GoHome();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show(this, "Arcade could not save the new settings.", "Parent settings",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs args)
    {
        if (args.CloseReason == CloseReason.UserClosing && !canClose) args.Cancel = true;
        base.OnFormClosing(args);
    }

    protected override void WndProc(ref Message message)
    {
        const int systemCommand = 0x0112;
        const int minimizeWindow = 0xF020;
        if (message.Msg == systemCommand && (message.WParam.ToInt64() & 0xFFF0) == minimizeWindow) return;
        base.WndProc(ref message);
    }
}
