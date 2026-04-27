using Spectre.Console;
using Color = Spectre.Console.Color;

namespace ToolManager.UI;

/// <summary>
/// Interactive numbered menu with arrow-key, vim-style, and number-shortcut navigation.
/// Pressing Esc or Backspace selects "Cancel" or "Back" when present.
/// </summary>
public static class NumberedMenu
{
    public static string Show(string title, List<string> choices, Color? highlightColor = null, bool showHints = true)
    {
        if (choices.Count == 0)
            throw new ArgumentException("Menu must have at least one choice", nameof(choices));

        var color = highlightColor ?? Color.DodgerBlue1;
        int selected = 0;
        int hintRows = showHints ? 2 : 0;

        Console.CursorVisible = false;

        try
        {
            AnsiConsole.MarkupLine(title);

            int menuStartRow = Console.CursorTop;
            for (int i = 0; i < choices.Count + hintRows; i++)
                Console.WriteLine();

            int width = Math.Max(Console.WindowWidth - 1, 1);

            void Render()
            {
                for (int i = 0; i < choices.Count; i++)
                {
                    SafeSetCursor(0, menuStartRow + i);
                    Console.Write(new string(' ', width));
                    SafeSetCursor(0, menuStartRow + i);

                    string numLabel = (i + 1 <= 9) ? $"{i + 1}" : " ";

                    if (i == selected)
                        AnsiConsole.Markup($"  [{color} bold]\u25b8 {numLabel}.[/] [{color} bold]{choices[i]}[/]");
                    else
                        AnsiConsole.Markup($"    [grey50]{numLabel}.[/] {choices[i]}");
                }

                if (showHints)
                {
                    int hintRow = menuStartRow + choices.Count + 1;
                    SafeSetCursor(0, hintRow);
                    Console.Write(new string(' ', width));
                    SafeSetCursor(0, hintRow);
                    AnsiConsole.Markup(
                        "  [grey42]\u2191\u2193 navigate  \u00b7  1\u20139 quick select  \u00b7  Enter confirm  \u00b7  Esc cancel[/]");
                }

                SafeSetCursor(0, menuStartRow + choices.Count + hintRows);
            }

            string FinalizeAndReturn(string val)
            {
                if (showHints)
                {
                    int hintRow = menuStartRow + choices.Count + 1;
                    SafeSetCursor(0, hintRow);
                    Console.Write(new string(' ', width));
                }
                SafeSetCursor(0, menuStartRow + choices.Count);
                return val;
            }

            string? CancelOption() =>
                choices.FirstOrDefault(c => c == "Cancel") ?? choices.FirstOrDefault(c => c == "Back");

            Render();

            while (true)
            {
                var key = Console.ReadKey(true);

                switch (key.Key)
                {
                    case ConsoleKey.UpArrow:
                    case ConsoleKey.K when key.Modifiers == 0:
                        selected = (selected - 1 + choices.Count) % choices.Count;
                        Render();
                        break;

                    case ConsoleKey.DownArrow:
                    case ConsoleKey.J when key.Modifiers == 0:
                        selected = (selected + 1) % choices.Count;
                        Render();
                        break;

                    case ConsoleKey.Home:
                        selected = 0;
                        Render();
                        break;

                    case ConsoleKey.End:
                        selected = choices.Count - 1;
                        Render();
                        break;

                    case ConsoleKey.PageUp:
                        selected = Math.Max(0, selected - 5);
                        Render();
                        break;

                    case ConsoleKey.PageDown:
                        selected = Math.Min(choices.Count - 1, selected + 5);
                        Render();
                        break;

                    case ConsoleKey.Enter:
                        return FinalizeAndReturn(choices[selected]);

                    case ConsoleKey.Escape:
                    case ConsoleKey.Backspace:
                    case ConsoleKey.Q when key.Modifiers == 0:
                        var cancel = CancelOption();
                        if (cancel != null)
                            return FinalizeAndReturn(cancel);
                        break;

                    default:
                        if (key.KeyChar >= '1' && key.KeyChar <= '9')
                        {
                            int idx = key.KeyChar - '1';
                            if (idx < choices.Count)
                                return FinalizeAndReturn(choices[idx]);
                        }
                        break;
                }
            }
        }
        finally
        {
            Console.CursorVisible = true;
        }
    }

    /// <summary>
    /// Defensive SetCursorPosition that clamps coordinates so we never crash on tiny consoles
    /// or after the buffer scrolls during rendering.
    /// </summary>
    private static void SafeSetCursor(int left, int top)
    {
        try
        {
            int safeLeft = Math.Clamp(left, 0, Math.Max(0, Console.BufferWidth - 1));
            int safeTop = Math.Clamp(top, 0, Math.Max(0, Console.BufferHeight - 1));
            Console.SetCursorPosition(safeLeft, safeTop);
        }
        catch (IOException) { /* console may be detached during shutdown */ }
        catch (ArgumentOutOfRangeException) { /* buffer changed mid-render */ }
    }
}
