$vault = "0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a"
$usdt = "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE"

# balanceOf(vault)
$selector = "70a08231"
$padded = ("000000000000000000000000" + $vault.Substring(2)).Substring((-40))
$data = "0x" + $selector + $padded

$body = @{
    jsonrpc = "2.0"
    method = "eth_call"
    params = @(
        @{
            to = $usdt
            data = $data
        },
        "latest"
    )
    id = 1
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://rpc.mantle.xyz" -Method Post -ContentType "application/json" -Body $body

if ($response.result) {
    $balance = [System.Numerics.BigInteger]::Parse($response.result.Substring(2), [System.Globalization.NumberStyles]::HexNumber)
    $balanceFloat = $balance / [System.Numerics.BigInteger]::Parse("1000000")
    Write-Host "Vault USDT balance: $balanceFloat (in USDT units)"
} else {
    Write-Host "Error: $($response.error.message)"
}
