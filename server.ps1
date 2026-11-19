param(
  [int]$Port = 8843,
  [string]$Root = "step-five",
  # song folder, same API as pi/server.py (songs/index.json + songs/<file>);
  # used only if the folder exists, so by default this behaves like GitHub Pages
  [string]$Songs = "songs-dev"
)

$ErrorActionPreference = "Stop"
$rootPath = Join-Path $PSScriptRoot $Root
$rootPath = (Resolve-Path $rootPath).Path
$songsPath = if ([System.IO.Path]::IsPathRooted($Songs)) { $Songs } else { Join-Path $PSScriptRoot $Songs }
$audioExt = @(".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".webm")

function Send-Bytes($response, [byte[]]$bytes, [string]$type) {
  $response.ContentType = $type
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

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
      $response.Headers.Add("Cache-Control", "no-store")
      if ($urlPath.StartsWith("/songs/") -and (Test-Path $songsPath -PathType Container)) {
        $songName = $urlPath.Substring(7)
        if ($songName -eq "index.json") {
          $items = @(Get-ChildItem -LiteralPath $songsPath -File | Where-Object { $audioExt -contains $_.Extension.ToLower() -and -not $_.Name.StartsWith(".") } | Sort-Object Name | ForEach-Object {
            [ordered]@{ name = $_.Name; size = $_.Length; mtime = [long]([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds(); url = "songs/" + [System.Uri]::EscapeDataString($_.Name) }
          })
          $json = ConvertTo-Json -InputObject ([ordered]@{ folder = (Resolve-Path $songsPath).Path; songs = $items }) -Depth 4 -Compress
          Send-Bytes $response ([System.Text.Encoding]::UTF8.GetBytes($json)) "application/json; charset=utf-8"
        } else {
          $songFile = Join-Path $songsPath $songName
          if ($songName -match '[\\/]' -or $songName.StartsWith(".") -or -not (Test-Path -LiteralPath $songFile -PathType Leaf)) {
            $response.StatusCode = 404
          } else {
            Send-Bytes $response ([System.IO.File]::ReadAllBytes($songFile)) "audio/mpeg"
          }
        }
        continue
      }
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
