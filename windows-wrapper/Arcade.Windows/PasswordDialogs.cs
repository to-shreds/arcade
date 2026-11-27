using Arcade.Windows.Core;

namespace Arcade.Windows;

internal sealed class PasswordDialogs : Form
{
    private readonly TextBox password = PasswordField("Parent password");
    private readonly TextBox confirm = PasswordField("Confirm password");
    private readonly Label feedback = new()
    {
        AutoSize = false, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.DarkRed
    };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 100 };
    private readonly Button accept;
    public ParentPassword? Password { get; private set; }

    private PasswordDialogs(string title, ParentPassword? existing, PasswordRetry? retry)
    {
        var creating = existing is null;
        Text = title;
        Font = new Font("Segoe UI", 10f);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        MinimizeBox = false;
        MaximizeBox = false;
        ClientSize = new Size(400, creating ? 242 : 194);
        var layout = new TableLayoutPanel { ColumnCount = 1, Dock = DockStyle.Fill, Padding = new Padding(16) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.Controls.Add(new Label
        {
            AutoSize = true,
            Text = creating ? "Choose a parent password with 8 to 128 characters." : "Enter the parent password."
        });
        layout.Controls.Add(password);
        if (creating)
        {
            layout.Controls.Add(new Label { AutoSize = true, Text = "Confirm password" });
            layout.Controls.Add(confirm);
        }
        layout.Controls.Add(feedback);
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        if (creating)
        {
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        }
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        accept = MakeButton(creating ? "Save password" : "Continue");
        var cancel = MakeButton("Cancel");
        cancel.DialogResult = DialogResult.Cancel;
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = false };
        buttons.Controls.AddRange([accept, cancel]);
        layout.Controls.Add(buttons);
        Controls.Add(layout);
        AcceptButton = accept;
        CancelButton = cancel;
        accept.Click += (_, _) =>
        {
            if (creating)
            {
                if (!ParentPassword.IsValidLength(password.Text))
                {
                    feedback.Text = "Use 8 to 128 characters.";
                    return;
                }
                if (password.Text != confirm.Text)
                {
                    feedback.Text = "The passwords do not match.";
                    return;
                }
                Password = ParentPassword.Create(password.Text);
            }
            else
            {
                if (!retry!.Ready) return;
                if (!existing!.Verify(password.Text))
                {
                    retry.RecordFailure();
                    accept.Enabled = false;
                    password.Clear();
                    feedback.Text = "That password did not match. Try again shortly.";
                    return;
                }
                retry.RecordSuccess();
            }
            DialogResult = DialogResult.OK;
        };
        Shown += (_, _) => password.Focus();
        if (retry is not null)
        {
            accept.Enabled = retry.Ready;
            if (!retry.Ready) feedback.Text = "Wait a moment before trying again.";
            timer.Tick += (_, _) => accept.Enabled = retry.Ready;
            timer.Start();
        }
    }

    public static PasswordDialogs NewPassword(string title) => new(title, null, null);
    public static PasswordDialogs VerifyPassword(string title, ParentPassword expected, PasswordRetry retry) =>
        new(title, expected, retry);

    public static Button MakeButton(string text) => new()
    {
        Text = text, AutoSize = true, MinimumSize = new Size(76, 38),
        Padding = new Padding(8, 2, 8, 2), UseVisualStyleBackColor = true, ForeColor = SystemColors.ControlText
    };

    private static TextBox PasswordField(string name) => new()
    {
        AccessibleName = name, Dock = DockStyle.Fill, UseSystemPasswordChar = true, MaxLength = 128
    };

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose();
            password.Clear();
            confirm.Clear();
        }
        base.Dispose(disposing);
    }
}

internal sealed class SettingsDialog : Form
{
    private readonly CheckedListBox activities = new()
    {
        Dock = DockStyle.Fill, CheckOnClick = true, AccessibleName = "Allowed activities"
    };
    private readonly ChildActivity[] available;
    public ParentPassword Password { get; private set; }
    public string[] ActivityIds => activities.CheckedIndices.Cast<int>().Select(index => available[index].Id).ToArray();

    public SettingsDialog(ChildActivity[] choices, ISet<string> allowed, ParentPassword existing)
    {
        Password = existing;
        available = choices.OrderBy(item => item.Title, StringComparer.OrdinalIgnoreCase).ToArray();
        Text = "Parent settings";
        Font = new Font("Segoe UI", 10f);
        ShowInTaskbar = false;
        MinimizeBox = false;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(495, 480);
        MinimumSize = new Size(415, 320);

        foreach (var activity in available) activities.Items.Add(activity.Title, allowed.Contains(activity.Id));
        var label = new Label
        {
            Text = "Choose the offline activities available in this window.",
            Dock = DockStyle.Fill, AutoSize = true
        };
        var change = PasswordDialogs.MakeButton("Change password");
        var save = PasswordDialogs.MakeButton("Save");
        var cancel = PasswordDialogs.MakeButton("Cancel");
        save.DialogResult = DialogResult.OK;
        cancel.DialogResult = DialogResult.Cancel;
        change.Click += (_, _) =>
        {
            using var dialog = PasswordDialogs.NewPassword("Change parent password");
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            Password = dialog.Password!;
            change.Text = "New password ready to save";
        };
        var bar = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = false };
        bar.Controls.AddRange([change, save, cancel]);
        var layout = new TableLayoutPanel { ColumnCount = 1, RowCount = 3, Dock = DockStyle.Fill, Padding = new Padding(12) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(label, 0, 0);
        layout.Controls.Add(activities, 0, 1);
        layout.Controls.Add(bar, 0, 2);
        Controls.Add(layout);
        // The list must keep Space and Enter available while choosing activities.
        CancelButton = cancel;
    }
}
