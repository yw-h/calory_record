using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const int Port = 5173;
    private const string HealthUrl = "http://localhost:5173/api/health";
    private const string AppUrl = "http://localhost:5173";

    [STAThread]
    private static void Main()
    {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string serverPath = Path.Combine(appDir, "server.js");

        if (!File.Exists(serverPath))
        {
            MessageBox.Show("找不到 server.js，请把启动程序放在应用根目录。", "每日食谱记录", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        if (!IsHealthy())
        {
            StartServer(appDir);
            if (!WaitForServer())
            {
                MessageBox.Show("本地服务启动失败。请确认已安装 Node.js，并且 5173 端口没有被其他程序占用。", "每日食谱记录", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
        }

        OpenBrowser();
    }

    private static void StartServer(string appDir)
    {
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = "node";
        startInfo.Arguments = "server.js";
        startInfo.WorkingDirectory = appDir;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.WindowStyle = ProcessWindowStyle.Hidden;

        Process.Start(startInfo);
    }

    private static bool WaitForServer()
    {
        for (int i = 0; i < 40; i++)
        {
            if (IsHealthy())
            {
                return true;
            }

            Thread.Sleep(250);
        }

        return false;
    }

    private static bool IsHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(HealthUrl);
            request.Method = "GET";
            request.Timeout = 500;

            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void OpenBrowser()
    {
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = AppUrl;
        startInfo.UseShellExecute = true;
        Process.Start(startInfo);
    }
}
