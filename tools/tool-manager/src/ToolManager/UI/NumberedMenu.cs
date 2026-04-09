using Spectre.Console;
using Color = Spectre.Console.Color;

namespace ToolManager.UI;

/// <summary>
/// Interactive numbered menu that supports arrow key navigation and
/// number key shortcuts (1–9) for quick selection.
/// </summary>
public static class NumberedMenu
{
    public static string Show(string title, List<string> choices, Color? highlightColor = null)
    {
        var color = highlightColor ?? Color.DodgerBlue1;
        int selected = 0;

        Console.CursorVisible = false;

        try
        {
            AnsiConsole.MarkupLine(title);

            // Reserve vertical space so SetCursorPosition works even near the bottom
            int menuStartRow = Console.CursorTop;
            for (int i = 0; i < choices.Count; i++)
                Console.WriteLine();

            void Render()
            {
                for (int i = 0; i < choices.Count; i++)
                {
                    Console.SetCursorPosition(0, menuStartRow + i);

                    // Clear the line
                    int clearLen = Math.Max(Console.WindowWidth - 1, 0);
                    Console.Write(new string(' ', clearLen));
                    Console.SetCursorPosition(0, menuStartRow + i);

                    string numLabel = (i + 1 <= 9) ? $"{i + 1}" : " ";

                    if (i == selected)
                    {
                        AnsiConsole.Markup($"  [{color} bold]> {numLabel}.[/] [{color} bold]{choices[i]}[/]");
                    }
                    else
                    {
                        AnsiConsole.Markup($"    [dim]{numLabel}.[/] {choices[i]}");
                    }
                }

                // Park the cursor below the menu
                Console.SetCursorPosition(0, menuStartRow + choices.Count);
            }

            Render();

            while (true)
            {
                var key = Console.ReadKey(true);

                switch (key.Key)
                {
                    case ConsoleKey.UpArrow:
                        selected = (selected - 1 + choices.Count) % choices.Count;
                        Render();
                        break;

                    case ConsoleKey.DownArrow:
                        selected = (selected + 1) % choices.Count;
                        Render();
                        break;

                    case ConsoleKey.Enter:
                        return choices[selected];

                    default:
                        if (key.KeyChar >= '1' && key.KeyChar <= '9')
                        {
                            int idx = key.KeyChar - '1';
                            if (idx < choices.Count)
                                return choices[idx];
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
}
