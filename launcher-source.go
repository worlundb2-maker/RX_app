package main

import (
    "errors"
    "fmt"
    "io"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"
)

const (
    appURL          = "http://127.0.0.1:5000"
    bootstrapURL    = "http://127.0.0.1:5000/api/bootstrap"
    serverLogName   = "launcher-server.log"
    launcherLogName = "launcher.log"
)

func main() {
    exePath, err := os.Executable()
    if err != nil {
        fmt.Println("Unable to determine launcher location:", err)
        os.Exit(1)
    }
    appDir := filepath.Dir(exePath)

    logPath := filepath.Join(appDir, launcherLogName)
    logFile, _ := os.Create(logPath)
    defer logFile.Close()
    log := io.MultiWriter(logFile)
    writeLog(log, "Launcher starting in %s", appDir)

    if appIsReachable() {
        writeLog(log, "App already reachable. Opening browser.")
        _ = openBrowser(appURL)
        return
    }

    nodeDir, nodeExe, err := findNodeRuntime(appDir)
    if err != nil {
        fail(log, logPath, "Node runtime was not found beside the launcher or in the standard Windows locations.", err)
    }
    writeLog(log, "Using Node runtime at %s", nodeDir)

    env := prependPath(os.Environ(), nodeDir)
    env = append(env, "NODE_ENV=production")

    serverCmd, serverArgs, err := findServerStart(appDir, nodeExe)
    if err != nil {
        fail(log, logPath, "The packaged server files are incomplete.", err)
    }
    writeLog(log, "Server start command: %s %s", serverCmd, strings.Join(serverArgs, " "))

    serverLogPath := filepath.Join(appDir, serverLogName)
    serverLog, err := os.OpenFile(serverLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
    if err != nil {
        fail(log, logPath, "Unable to create the server log file.", err)
    }
    defer serverLog.Close()

    cmd := exec.Command(serverCmd, serverArgs...)
    cmd.Dir = appDir
    cmd.Env = env
    cmd.Stdout = serverLog
    cmd.Stderr = serverLog
    if err := cmd.Start(); err != nil {
        fail(log, logPath, "Unable to start the local server process.", err)
    }
    writeLog(log, "Server process launched with PID %d", cmd.Process.Pid)

    if err := waitForApp(75 * time.Second); err != nil {
        failWithServer(log, logPath, serverLogPath, "The local server did not become ready.", err)
    }

    writeLog(log, "App reachable. Opening browser.")
    if err := openBrowser(appURL); err != nil {
        failWithServer(log, logPath, serverLogPath, "The browser could not be opened automatically.", err)
    }
}

func fail(log io.Writer, logPath string, message string, err error) {
    writeLog(log, "ERROR: %s: %v", message, err)
    _ = openLog(logPath)
    os.Exit(1)
}

func failWithServer(log io.Writer, logPath, serverLogPath, message string, err error) {
    writeLog(log, "ERROR: %s: %v", message, err)
    _ = openLog(serverLogPath)
    _ = openLog(logPath)
    os.Exit(1)
}

func openLog(path string) error {
    return exec.Command("notepad.exe", path).Start()
}

func writeLog(w io.Writer, format string, args ...any) {
    line := fmt.Sprintf(format, args...)
    fmt.Fprintf(w, "%s %s\n", time.Now().Format("2006-01-02 15:04:05"), line)
}

func prependPath(env []string, dir string) []string {
    out := make([]string, 0, len(env)+1)
    found := false
    for _, item := range env {
        if strings.HasPrefix(strings.ToUpper(item), "PATH=") {
            value := item[5:]
            out = append(out, "PATH="+dir+";"+value)
            found = true
        } else {
            out = append(out, item)
        }
    }
    if !found {
        out = append(out, "PATH="+dir)
    }
    return out
}

func pathExists(p string) bool {
    _, err := os.Stat(p)
    return err == nil
}

func appIsReachable() bool {
    client := http.Client{Timeout: 1500 * time.Millisecond}
    resp, err := client.Get(bootstrapURL)
    if err != nil {
        return false
    }
    defer resp.Body.Close()
    return resp.StatusCode >= 200 && resp.StatusCode < 500
}

func waitForApp(timeout time.Duration) error {
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if appIsReachable() {
            return nil
        }
        time.Sleep(1500 * time.Millisecond)
    }
    return errors.New("timeout waiting for app startup")
}

func openBrowser(url string) error {
    return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func findNodeRuntime(appDir string) (string, string, error) {
    candidates := []string{}

    explicit := []string{
        filepath.Join(appDir, "node-v24.14.0-win-x64"),
        filepath.Join(appDir, "node-runtime"),
    }
    candidates = append(candidates, explicit...)

    if matches, _ := filepath.Glob(filepath.Join(appDir, "node-v*-win-x64")); len(matches) > 0 {
        candidates = append(candidates, matches...)
    }

    candidates = append(candidates,
        `C:\Program Files\nodejs`,
        `C:\Program Files (x86)\nodejs`,
    )
    if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
        candidates = append(candidates, filepath.Join(localAppData, "Programs", "nodejs"))
    }

    seen := map[string]bool{}
    for _, dir := range candidates {
        key := strings.ToLower(dir)
        if dir == "" || seen[key] {
            continue
        }
        seen[key] = true
        nodeExe := filepath.Join(dir, "node.exe")
        if pathExists(nodeExe) {
            return dir, nodeExe, nil
        }
    }

    return "", "", errors.New("node.exe not found")
}

func findServerStart(appDir, nodeExe string) (string, []string, error) {
    tsxCli := filepath.Join(appDir, "node_modules", "tsx", "dist", "cli.mjs")
    if pathExists(tsxCli) && pathExists(filepath.Join(appDir, "server", "index.ts")) {
        return nodeExe, []string{tsxCli, filepath.Join(appDir, "server", "index.ts"), "--production"}, nil
    }

    compiledServer := filepath.Join(appDir, "dist", "index.cjs")
    if pathExists(compiledServer) {
        return nodeExe, []string{compiledServer}, nil
    }

    return "", nil, errors.New("neither packaged node_modules/tsx nor dist/index.cjs is present")
}
