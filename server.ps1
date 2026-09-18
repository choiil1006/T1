param(
  [int]$Port = 8843,
  [string]$Root = "step-five"
)

$ErrorActionPreference = "Stop"
$rootPath = Join-Path $PSScriptRoot $Root
$rootPath = (Resolve-Path $rootPath).Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $rootPath at http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    try {
      $urlPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
      if ($urlPath -eq "/") { $urlPath = "/index.html" }
      $filePath = Join-Path $rootPath ($urlPath.TrimStart("/"))
      $filePath = [System.IO.Path]::GetFullPath($filePath)

      if (-not $filePath.StartsWith($rootPath)) {
        $response.StatusCode = 403
      } elseif (-not (Test-Path $filePath -PathType Leaf)) {
        $response.StatusCode = 404
      } else {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $contentType = $mime[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $response.ContentType = $contentType
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      $response.StatusCode = 500
    } finally {
      $response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
