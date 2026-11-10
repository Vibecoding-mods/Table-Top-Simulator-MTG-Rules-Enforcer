// The status window (one row per start step) and the tray icon. All work happens on the Controller's thread; this
// file only draws and turns clicks into Controller calls.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace MtgCompanion
{
    public static class Icons
    {
        public static Color Of(Light l)
        {
            switch (l)
            {
                case Light.Green: return Color.FromArgb(46, 160, 67);
                case Light.Amber: return Color.FromArgb(219, 150, 0);
                case Light.Red: return Color.FromArgb(207, 34, 46);
                case Light.Busy: return Color.FromArgb(31, 111, 235);
                default: return Color.FromArgb(140, 140, 140);
            }
        }

        public static string Word(Light l)
        {
            switch (l)
            {
                case Light.Green: return "OK";
                case Light.Amber: return "Check";
                case Light.Red: return "Problem";
                case Light.Busy: return "Working";
                default: return "—";
            }
        }

        // a card with a coloured dot, drawn at any size
        public static Bitmap Draw(int size, Light l)
        {
            var b = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(b))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                float s = size / 16f;
                var card = new RectangleF(2.5f * s, 0.5f * s, 10f * s, 14f * s);
                using (var path = Rounded(card, 1.8f * s))
                {
                    using (var fill = new SolidBrush(Color.FromArgb(38, 41, 46))) g.FillPath(fill, path);
                    using (var pen = new Pen(Color.FromArgb(225, 225, 225), Math.Max(1f, 1.1f * s))) g.DrawPath(pen, path);
                }
                var dot = new RectangleF(7f * s, 7f * s, 8.5f * s, 8.5f * s);
                using (var fill = new SolidBrush(Of(l))) g.FillEllipse(fill, dot);
                using (var pen = new Pen(Color.White, Math.Max(1f, 1.1f * s))) g.DrawEllipse(pen, dot);
            }
            return b;
        }

        static GraphicsPath Rounded(RectangleF r, float rad)
        {
            var p = new GraphicsPath();
            float d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

        static readonly Dictionary<Light, Icon> cache = new Dictionary<Light, Icon>();

        public static Icon Tray(Light l)
        {
            Icon i;
            if (cache.TryGetValue(l, out i)) return i;
            using (var b = Draw(32, l))
            {
                IntPtr h = b.GetHicon();
                i = (Icon)Icon.FromHandle(h).Clone();
                DestroyIcon(h);
            }
            cache[l] = i;
            return i;
        }

        // an .ico with PNG frames (16, 24, 32, 48, 256), for build.cmd's /win32icon
        public static void WriteIco(string file)
        {
            var sizes = new[] { 16, 24, 32, 48, 256 };
            var pngs = sizes.Select(sz => { using (var b = Draw(sz, Light.Green)) using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); return ms.ToArray(); } }).ToList();
            using (var f = new FileStream(file, FileMode.Create))
            using (var w = new BinaryWriter(f))
            {
                w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
                int offset = 6 + 16 * sizes.Length;
                for (int i = 0; i < sizes.Length; i++)
                {
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i])); w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)0); w.Write((byte)0); w.Write((short)1); w.Write((short)32);
                    w.Write(pngs[i].Length); w.Write(offset);
                    offset += pngs[i].Length;
                }
                foreach (var p in pngs) w.Write(p);
            }
        }
    }

    // a filled dot, the light of one row
    class Dot : Control
    {
        Light light = Light.Grey;
        public Dot() { SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true); BackColor = Color.Transparent; }
        public Light Light { get { return light; } set { if (light != value) { light = value; Invalidate(); } } }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            int d = Math.Min(Width, Height) - 4;
            using (var b = new SolidBrush(Icons.Of(light))) e.Graphics.FillEllipse(b, (Width - d) / 2, (Height - d) / 2, d, d);
        }
    }

    public class StatusForm : Form
    {
        readonly Controller c;
        readonly NotifyIcon tray = new NotifyIcon();
        readonly Label game = new Label(), phase = new Label(), footer = new Label();
        readonly Dot[] dots = new Dot[6];
        readonly Label[] words = new Label[6], texts = new Label[6];
        readonly Button[] fixes = new Button[6];
        readonly TextBox hint = new TextBox();
        readonly Button restartBtn = new Button(), stopBtn = new Button(), logsBtn = new Button(), wslBtn = new Button();
        readonly ToolTip tips = new ToolTip();
        readonly ToolStripMenuItem miRestart, miStop, miVersion, miCheck;
        readonly EventWaitHandle showSignal;
        bool reallyQuit, toldAboutTray, blocking;
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string reason);
        [DllImport("user32.dll")] static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);
        const int WM_QUERYENDSESSION = 0x11;
        public const string BlockReason = "Finishing update…";

        public StatusForm(Controller controller, EventWaitHandle show)
        {
            c = controller;
            showSignal = show;
            Text = "MTG Companion" + (c.Observe ? " (observe only: changes nothing)" : "") + (c.L.Friend ? "" : " - home mode");
            Font = new Font("Segoe UI", 9.5f);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(760, 520);
            MinimumSize = new Size(560, 420);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = Icons.Tray(Light.Busy);
            BackColor = SystemColors.Window;

            var top = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(12, 10, 12, 8) };
            top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            top.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            top.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            top.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            top.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            top.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            top.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            game.AutoSize = true; game.Font = new Font(Font.FontFamily, 11f, FontStyle.Bold); game.Margin = new Padding(0, 0, 0, 2);
            phase.AutoSize = true; phase.ForeColor = SystemColors.GrayText; phase.Margin = new Padding(0, 0, 0, 8);
            top.Controls.Add(game);
            top.Controls.Add(phase);

            var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 5 };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 26));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 66));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            for (int i = 0; i < 6; i++)
            {
                int row = i;
                dots[i] = new Dot { Size = new Size(18, 18), Margin = new Padding(2, 5, 2, 2) };
                var name = new Label { Text = Controller.Names[i], AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(2, 6, 2, 2) };
                words[i] = new Label { AutoSize = true, Margin = new Padding(2, 6, 2, 2), ForeColor = SystemColors.GrayText };
                texts[i] = new Label { AutoSize = true, MaximumSize = new Size(440, 0), Margin = new Padding(2, 6, 6, 6) };
                fixes[i] = new Button { AutoSize = true, Visible = false, Margin = new Padding(2, 2, 2, 2) };
                fixes[i].Click += (s, e) => OnFix(row);
                grid.Controls.Add(dots[i], 0, i);
                grid.Controls.Add(name, 1, i);
                grid.Controls.Add(words[i], 2, i);
                grid.Controls.Add(texts[i], 3, i);
                grid.Controls.Add(fixes[i], 4, i);
            }
            top.Controls.Add(grid);

            hint.Multiline = true; hint.ReadOnly = true; hint.Dock = DockStyle.Fill; hint.ScrollBars = ScrollBars.Vertical;
            hint.BackColor = SystemColors.Control; hint.BorderStyle = BorderStyle.FixedSingle; hint.Margin = new Padding(0, 8, 0, 8);
            top.Controls.Add(hint);

            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0) };
            logsBtn.Text = "Open logs folder"; logsBtn.AutoSize = true; logsBtn.Click += (s, e) => OpenLogs();
            restartBtn.Text = "Restart engine"; restartBtn.AutoSize = true; restartBtn.Click += (s, e) => DoRestart();
            stopBtn.Text = "Stop everything"; stopBtn.AutoSize = true; stopBtn.Click += (s, e) => DoStop(null);
            wslBtn.Text = "Limit Docker's CPU use…"; wslBtn.AutoSize = true; wslBtn.Click += (s, e) => WslLimits();
            buttons.Controls.AddRange(new Control[] { logsBtn, restartBtn, stopBtn, wslBtn });
            top.Controls.Add(buttons);

            footer.AutoSize = true; footer.ForeColor = SystemColors.GrayText; footer.Text = c.VersionText; footer.Margin = new Padding(0, 6, 0, 0);
            top.Controls.Add(footer);
            Controls.Add(top);

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open status", null, (s, e) => ShowMe());
            menu.Items.Add("Open logs folder", null, (s, e) => OpenLogs());
            menu.Items.Add(new ToolStripSeparator());
            miVersion = new ToolStripMenuItem(c.VersionShort) { Enabled = false };
            miCheck = new ToolStripMenuItem("Check for updates", null, (s, e) => c.CheckNow());
            menu.Items.Add(miVersion);
            menu.Items.Add(miCheck);
            menu.Items.Add("GitHub token…", null, (s, e) => TokenDialog());
            menu.Items.Add(new ToolStripSeparator());
            miRestart = new ToolStripMenuItem("Restart engine", null, (s, e) => DoRestart());
            miStop = new ToolStripMenuItem("Stop everything", null, (s, e) => DoStop(null));
            menu.Items.Add(miRestart);
            menu.Items.Add(miStop);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit", null, (s, e) => DoQuit());
            tray.ContextMenuStrip = menu;
            tray.Icon = Icons.Tray(Light.Busy);
            tray.Text = "MTG: starting";
            tray.Visible = true;
            tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ShowMe(); };

            c.Changed += () => { try { if (IsHandleCreated) BeginInvoke((Action)Render); } catch { } };
            c.UpdateOffered += r => { try { if (IsHandleCreated) BeginInvoke((Action)(() => OfferUpdate(r))); } catch { } };
            c.ExitForUpdate += () => { try { if (IsHandleCreated) BeginInvoke((Action)Exit); } catch { } };
            c.ApplyingChanged += () => { try { if (IsHandleCreated) BeginInvoke((Action)BlockShutdown); } catch { } };
            c.Notify += (t, x) => { try { if (IsHandleCreated) BeginInvoke((Action)(() => { if (!Visible) tray.ShowBalloonTip(8000, t, x, ToolTipIcon.Warning); })); } catch { } };
            var timer = new System.Windows.Forms.Timer { Interval = 2000 };
            timer.Tick += (s, e) => Render();
            timer.Start();
            if (showSignal != null)
            {
                var t = new Thread(() => { while (true) { showSignal.WaitOne(); try { BeginInvoke((Action)ShowMe); } catch { return; } } });
                t.IsBackground = true;
                t.Start();
            }
            OnResize(EventArgs.Empty);
            Render();
        }

        void ShowMe()
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            c.WindowVisible = true;
        }

        // while an update moves files, Windows shows "Finishing update…" and waits (the journal covers a forced end)
        void BlockShutdown()
        {
            bool want = c.Applying;
            if (want == blocking || !IsHandleCreated) return;
            blocking = want;
            try { if (want) ShutdownBlockReasonCreate(Handle, BlockReason); else ShutdownBlockReasonDestroy(Handle); } catch { }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_QUERYENDSESSION && c.Applying)
            {
                Log.Write("Windows asked to shut down during an update: asked it to wait");
                BlockShutdown();
                m.Result = IntPtr.Zero; // (FALSE: not now)
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (c.Applying && e.CloseReason != CloseReason.UserClosing) { e.Cancel = true; return; } // (shutdown, task manager's close: after the update)
            if (!reallyQuit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                c.WindowVisible = false;
                if (!toldAboutTray) { toldAboutTray = true; tray.ShowBalloonTip(5000, "MTG Companion", "Still running in the tray. Right-click the icon to stop or quit.", ToolTipIcon.Info); }
                return;
            }
            tray.Visible = false;
            base.OnFormClosing(e);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            int w = Math.Max(300, ClientSize.Width - 30);
            game.MaximumSize = new Size(w, 0);
            phase.MaximumSize = new Size(w, 0);
            foreach (var t in texts) if (t != null) t.MaximumSize = new Size(Math.Max(200, ClientSize.Width - 360), 0);
        }

        void Render()
        {
            var g = c.Game;
            game.Text = c.Observe ? "Observe only. " + g.Text : g.Text;
            game.ForeColor = g.Kind == GameKind.On ? Color.FromArgb(31, 111, 235) : SystemColors.ControlText;
            phase.Text = c.Phase + (c.L.Friend ? "" : "   (home mode: " + c.L.Home + ")");
            bool locked = c.IsLocked;
            string hintText = null;
            for (int i = 0; i < 6; i++)
            {
                var v = c.Rows[i].V;
                dots[i].Light = v.Light;
                words[i].Text = Icons.Word(v.Light);
                texts[i].Text = v.Text;
                bool show = v.Fix != null && (v.Light == Light.Red || v.Light == Light.Amber) && !c.Observe;
                fixes[i].Visible = show;
                if (show)
                {
                    fixes[i].Text = v.FixLabel;
                    bool lockedFix = Fixes.LocksDuringGame(v.Fix) && locked;
                    fixes[i].Enabled = !lockedFix;
                    tips.SetToolTip(fixes[i], lockedFix ? Logic.LockText(g) : "");
                }
                if (hintText == null && v.Hint != null && v.Light != Light.Green && v.Light != Light.Grey) hintText = v.Hint;
            }
            if (hintText == null)
                hintText = Logic.TtsHowTo(c.SaveName) + "\r\n\r\nOnly the host runs this app. Friends join your TTS game (Multiplayer) and need nothing else.";
            if (hint.Text != hintText) hint.Text = hintText;
            string ft = c.VersionText + (c.UpdateLine.Length > 0 ? "\r\n" + c.UpdateLine : "");
            if (footer.Text != ft) footer.Text = ft;
            string vt = c.VersionShort + (c.UpdateLine.Length > 0 ? " · " + Logic.Clip(c.UpdateLine, 70) : "");
            if (miVersion.Text != vt) miVersion.Text = vt;
            miCheck.Enabled = c.L.Friend && !c.Observe;
            restartBtn.Enabled = miRestart.Enabled = !locked && !c.Observe;
            tips.SetToolTip(restartBtn, locked ? Logic.LockText(g) : "Stops the bridge, restarts relay and room, then starts the bridge again.");
            stopBtn.Enabled = miStop.Enabled = !c.Observe;
            wslBtn.Enabled = !c.Observe;
            miRestart.Text = locked ? "Restart engine (locked: game on)" : "Restart engine";

            var worst = Logic.Worst(c.Rows.Select(r => r.V.Light));
            var icon = Icons.Tray(worst == Light.Grey ? Light.Grey : worst);
            if (tray.Icon != icon) { tray.Icon = icon; Icon = icon; }
            var red = c.Rows.FirstOrDefault(r => r.V.Light == Light.Red);
            string tip = red != null ? "MTG: " + red.Name + " problem"
                : worst == Light.Busy ? "MTG: " + c.Phase
                : worst == Light.Amber ? "MTG: " + c.Rows.Count(r => r.V.Light == Light.Amber) + " to check"
                : worst == Light.Grey ? "MTG: stopped"
                : (g.Kind == GameKind.On ? "MTG: game on" : "MTG: ready");
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
        }

        void OnFix(int row)
        {
            var v = c.Rows[row].V;
            if (v.Fix == null) return;
            if (v.Fix == Fixes.ShowProgram) { ShowProgram(v); return; }
            if (v.Fix == Fixes.StackRestart || v.Fix == Fixes.BridgeRestart || v.Fix == Fixes.ImagesLoad)
            {
                string what = v.Fix == Fixes.StackRestart ? "Restart the relay and the Forge room (about 20 s)?"
                    : v.Fix == Fixes.BridgeRestart ? "Restart the bridge (a few seconds)? TTS will redraw the table."
                    : "Load the engine images from the package again (a few minutes)?";
                if (MessageBox.Show(this, what, "MTG Companion", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            }
            var refused = c.DoFix(row, v.Fix);
            if (refused != null) MessageBox.Show(this, refused, "MTG Companion", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        // Update available: Update now / Later
        void OfferUpdate(CheckResult r)
        {
            using (var d = new Form { Text = "MTG Companion", FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen, ClientSize = new Size(460, 170), Font = Font, ShowInTaskbar = true, TopMost = true })
            {
                var text = new Label { Text = r.Text + "\r\n\r\nThe update waits until no game is on. It stops the bridge for a moment, keeps a copy of the old files, and goes back to them if anything fails.", Location = new Point(14, 12), Size = new Size(432, 100) };
                var now = new Button { Text = "Update now", DialogResult = DialogResult.OK, AutoSize = true, Location = new Point(250, 126) };
                var later = new Button { Text = "Later", DialogResult = DialogResult.Cancel, AutoSize = true, Location = new Point(360, 126) };
                d.Controls.AddRange(new Control[] { text, now, later });
                d.AcceptButton = now; d.CancelButton = later;
                if (d.ShowDialog() == DialogResult.OK) c.UpdateNow();
                else c.Later();
            }
        }

        // the optional token for a private repository (DPAPI, this Windows user; sent only to api.github.com)
        void TokenDialog()
        {
            using (var d = new Form { Text = "GitHub token", FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen, ClientSize = new Size(480, 190), Font = Font })
            {
                var text = new Label { Text = "Only needed while the project's GitHub repository is private. A read-only token for that repository is enough. It is kept encrypted for this Windows user and sent only to api.github.com, to read the releases. Leave it empty and press Save to remove it.", Location = new Point(14, 12), Size = new Size(452, 80) };
                var box = new TextBox { UseSystemPasswordChar = true, Location = new Point(14, 100), Size = new Size(452, 24) };
                var save = new Button { Text = "Save", DialogResult = DialogResult.OK, AutoSize = true, Location = new Point(290, 146) };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true, Location = new Point(380, 146) };
                d.Controls.AddRange(new Control[] { text, box, save, cancel });
                d.AcceptButton = save; d.CancelButton = cancel;
                if (d.ShowDialog(this) != DialogResult.OK) return;
                try
                {
                    TokenStore.Save(c.StateDir, box.Text);
                    Log.Write(box.Text.Trim().Length > 0 ? "GitHub token saved" : "GitHub token removed");
                    MessageBox.Show(this, box.Text.Trim().Length > 0 ? "Saved. It is used from the next check (restart the app, then Check for updates)." : "Removed.", "MTG Companion");
                }
                catch (Exception e) { MessageBox.Show(this, "Couldn't save it: " + e.Message, "MTG Companion"); }
            }
        }

        void ShowProgram(Verdict v)
        {
            MessageBox.Show(this, v.Text + "\r\n\r\nTask Manager opens next: find the program on the Details tab (the process number is in the sentence above) and close it yourself, then press Try again on the Bridge row.", "MTG Companion", MessageBoxButtons.OK, MessageBoxIcon.Information);
            try { Process.Start("taskmgr.exe", "/0 /startup"); } catch { }
            c.DoFix(Controller.StepBridge, Fixes.Retry);
        }

        void OpenLogs()
        {
            try { Directory.CreateDirectory(c.L.LogsDir); Process.Start("explorer.exe", "\"" + c.L.LogsDir + "\""); } catch { }
        }

        void DoRestart()
        {
            if (c.IsLocked) { MessageBox.Show(this, Logic.LockText(c.Game), "MTG Companion"); return; }
            if (MessageBox.Show(this, "Restart the engine? This stops the bridge, restarts the relay and the Forge room, and starts the bridge again (under a minute).", "MTG Companion", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            var r = c.RestartEngine();
            if (r != null) MessageBox.Show(this, r, "MTG Companion");
        }

        bool DoStop(Action then)
        {
            string ask = c.IsLocked
                ? c.Game.Text + "\r\n\r\nStopping everything ends that game for everyone. Stop anyway?"
                : "Stop the bridge and the engine containers? Docker Desktop and TTS keep running.";
            var icon = c.IsLocked ? MessageBoxIcon.Warning : MessageBoxIcon.Question;
            if (MessageBox.Show(this, ask, "MTG Companion", MessageBoxButtons.OKCancel, icon, MessageBoxDefaultButton.Button2) != DialogResult.OK) return false;
            c.StopEverything(then == null ? (Action)null : () => { try { BeginInvoke(then); } catch { } });
            return true;
        }

        void DoQuit()
        {
            if (c.Observe) { Exit(); return; }
            if (c.Applying) { MessageBox.Show(this, "An update is being installed. Quit when it's done (a minute or two).", "MTG Companion", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            var r = MessageBox.Show(this, "Quit MTG Companion?\r\n\r\nYes: quit and leave the engine and the bridge running (a game in progress carries on).\r\nNo: stop everything first, then quit.", "MTG Companion", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            if (r == DialogResult.Yes) Exit();
            else if (r == DialogResult.No) DoStop(Exit);
        }

        void Exit() { if (c.Applying) return; reallyQuit = true; tray.Visible = false; Close(); Application.Exit(); }

        public void ForceExit() { Exit(); }

        void WslLimits()
        {
            string file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".wslconfig");
            string now = Probes.ReadText(file);
            string msg = "Optional. Docker runs the engine in a Linux VM (WSL) that may use every CPU core, and Tabletop Simulator then has to share them. On a PC with 4–8 cores, giving Docker only 2 cores keeps TTS smoother; the engine thinks a little slower.\r\n\r\n"
                + "This writes processors=2 and memory=8GB into the [wsl2] section of\r\n    " + file + "\r\n(other lines are kept; a copy of the old file is saved beside it). It affects every WSL program on this PC, not only Docker, and takes effect the next time WSL restarts (for example after restarting the PC). Nothing restarts now.\r\n\r\n"
                + "Current file: " + (now == null ? "none" : "\r\n" + Logic.Clip(now.Trim(), 400)) + "\r\n\r\nWrite the limit?";
            if (MessageBox.Show(this, msg, "Limit Docker's CPU use", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            try
            {
                if (now != null) File.Copy(file, file + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmm"), true);
                File.WriteAllText(file, Logic.SetWslLimits(now, 2, "8GB"));
                Log.Write("wrote " + file + " (processors=2, memory=8GB), on the user's click");
                MessageBox.Show(this, "Saved. It takes effect after WSL restarts (restart the PC, or quit Docker Desktop and run \"wsl --shutdown\" yourself).", "MTG Companion");
            }
            catch (Exception e) { MessageBox.Show(this, "Couldn't write it: " + e.Message, "MTG Companion"); }
        }
    }
}
