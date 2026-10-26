param([string]$ProjectPath = (Get-Location).Path)
$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $PSScriptRoot
Write-Host "Instalando RESistemas v24 em $ProjectPath"
Copy-Item "$source\src\*" "$ProjectPath\src" -Recurse -Force
Copy-Item "$source\public\*" "$ProjectPath\public" -Recurse -Force
New-Item -ItemType Directory -Path "$ProjectPath\scripts" -Force | Out-Null
Copy-Item "$source\scripts\migrate-v24.js" "$ProjectPath\scripts\migrate-v24.js" -Force
$packagePath = Join-Path $ProjectPath "package.json"
$package = Get-Content $packagePath -Raw | ConvertFrom-Json
$package.version = "24.1.0"
if (-not $package.scripts) { $package | Add-Member scripts ([pscustomobject]@{}) }
$package.scripts | Add-Member -Force NoteProperty "db:v24" "node scripts/migrate-v24.js"
$dependencies = @{ "node-forge"="^1.3.1"; "xml-crypto"="^6.1.2" }
foreach($name in $dependencies.Keys){ if(-not $package.dependencies.$name){$package.dependencies|Add-Member NoteProperty $name $dependencies[$name]} }
$package | ConvertTo-Json -Depth 20 | Set-Content $packagePath -Encoding UTF8
Write-Host "Arquivos copiados. Execute: npm install; npm run db:v24; npm run dev"
