using Arcade.Windows.Core;

namespace Arcade.Windows;

internal static class Program
{
    [STAThread]
    public static void Main()
    {
        ApplicationConfiguration.Initialize();
        var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FamilyArcade");
        var settingsFile = Path.Combine(dataFolder, "parent-settings.json");
        try
        {
            Directory.CreateDirectory(dataFolder);
            using var session = File.Open(Path.Combine(dataFolder, "active.lock"), FileMode.OpenOrCreate,
                FileAccess.ReadWrite, FileShare.None);
            using var package = typeof(Program).Assembly.GetManifestResourceStream("Arcade.ChildSnapshot.zip")
                ?? throw new InvalidDataException("The bundled Arcade snapshot is missing.");
            using var snapshot = new ChildSnapshot(package);
            var settings = ParentSettings.Load(settingsFile);
            if (settings is null)
            {
                using var firstRun = PasswordDialogs.NewPassword("Set a parent password");
                if (firstRun.ShowDialog() != DialogResult.OK) return;
                settings = new ParentSettings(1, firstRun.Password!,
                    snapshot.Policy.Activities.Select(activity => activity.Id).ToArray());
                settings.Save(settingsFile);
            }
            Application.Run(new ChildWindow(snapshot, settings, settingsFile, Path.Combine(dataFolder, "WebView2")));
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            MessageBox.Show("Arcade could not open its local files. Close any other Arcade window and reopen the app. " +
                "If this continues, see “Owner recovery” in the Arcade Windows instructions.",
                "Arcade", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
