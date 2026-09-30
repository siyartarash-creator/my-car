# Gate 1 only. Run on an empty disposable local PostgreSQL 17 database after the
# Phase 1 migrations and local Auth/Storage test stubs are installed.
$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$conn = @('-X','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5432','-U','mycar_gate1','-d','mycar_gate1','-At','-q')
Write-Output 'Gate 1 target preflight'
function Query([string]$sql) {
  $output = & $psql @conn -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local SQL failed: $output" }
  return [string](@($output)[-1])
}
function Num([string]$sql) { return [long](Query $sql) }
function Assert([bool]$condition,[string]$message) { if (-not $condition) { throw $message } }
function Quote([string]$value) { return "'" + $value.Replace("'","''") + "'" }
$a='30000000-0000-0000-0000-000000000001'; $b='30000000-0000-0000-0000-000000000002'; $seller='30000000-0000-0000-0000-000000000003'
$address='{"full_name":"Gate One Buyer","mobile":"09100000001","province":"Tehran","city":"Tehran","street":"Main Street"}'
function Order([string]$uid,[int[]]$ids,[string]$key,[string]$coupon='',[long]$total=0) {
  $items='['+(($ids | ForEach-Object { '{"offer_id":'+$_+',"quantity":1}' }) -join ',')+']'
  if (-not $total) { $total=50000+100000*$ids.Count }
  $c=if ($coupon) { Quote $coupon } else { 'null' }
  return "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub',$(Quote $uid),false); SELECT json_build_object('pid',pg_backend_pid(),'result',public.place_order($(Quote $items),$(Quote $address),$(Quote $key),$total,$c));"
}
function Race([string]$first,[string]$second,[int]$success,[string]$expectedError='') {
  $jobs=@($first,$second) | ForEach-Object { $sql=$_; Start-Job -ArgumentList $sql -ScriptBlock {
    param($statement)
    $lines=& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U mycar_gate1 -d mycar_gate1 -At -q -c $statement 2>&1
    [pscustomobject]@{code=$LASTEXITCODE; lines=@($lines | ForEach-Object { [string]$_ })}
  }}
  try { $done=@($jobs | Wait-Job -Timeout 25); if ($done.Count -ne 2) { throw "Concurrent processes timed out: $($jobs | Select-Object Id,State,HasMoreData | ConvertTo-Json -Compress)" }; $results=@($jobs | ForEach-Object { Receive-Job $_ }); }
  finally { $jobs | Remove-Job -Force }
  Assert (($results | Where-Object code -eq 0).Count -eq $success) "Unexpected outcomes: $($results | ConvertTo-Json -Compress)"
  if ($expectedError) { Assert (($results | Where-Object code -ne 0).lines -join ' ' -match $expectedError) "Expected $expectedError" }
  $parsed=@($results | Where-Object code -eq 0 | ForEach-Object { $_.lines[-1] | ConvertFrom-Json })
  Assert (($parsed | Select-Object -ExpandProperty pid -Unique).Count -eq $parsed.Count) 'Connections were not independent'
  return ,$parsed
}
Assert ((Query "SELECT current_database()||':'||current_user||':'||current_setting('server_version_num')") -eq 'mycar_gate1:mycar_gate1:170011') 'Wrong database or server'
Assert ((Num 'SELECT count(*) FROM public.orders') -eq 0) 'Gate 1 database is not empty'
Assert ((Num 'SELECT count(*) FROM auth.users') -eq 0) 'Gate 1 database must have no users'
Assert ((Num 'SELECT count(*) FROM public.product_sellers') -eq 0) 'Gate 1 database must have no offers'
Assert ((Num 'SELECT count(*) FROM public.products') -eq 0) 'Gate 1 database must have no products'
Assert ((Num 'SELECT count(*) FROM public.coupons') -eq 0) 'Gate 1 database must have no coupons'
Write-Output 'Gate 1 fixture ready'
Query "INSERT INTO auth.users(id,raw_user_meta_data) VALUES ('$a','{""name"":""Buyer A"",""mobile"":""09100000001"",""user_type"":""owner""}'),('$b','{""name"":""Buyer B"",""mobile"":""09100000002"",""user_type"":""owner""}'),('$seller','{""name"":""Seller"",""mobile"":""09100000003"",""user_type"":""seller""}');" | Out-Null
Query "INSERT INTO public.products(id,name,slug) VALUES(1,'Part','gate-one-part');" | Out-Null
Query "INSERT INTO public.product_sellers(id,product_id,seller_id,seller_name,price,stock) SELECT id,1,'$seller','Seller',100000,stock FROM (VALUES (101,1),(102,2),(103,2),(104,2),(105,2),(106,2),(107,2),(108,2),(109,2)) v(id,stock);" | Out-Null
Query "INSERT INTO public.coupons(code,discount_type,discount_value,max_uses,max_uses_per_user) VALUES('GATE_ONCE','fixed',10000,1,null),('GATE_PER_USER','fixed',10000,null,1);" | Out-Null
$before=Num 'SELECT count(*) FROM public.orders'
Write-Output 'Gate 1 racing last unit'
Race (Order $a @(101) '30000000-0000-0000-0000-000000000101') (Order $b @(101) '30000000-0000-0000-0000-000000000102') 1 'offer_unavailable' | Out-Null
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+1) 'Last-unit order count'
Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=101') -eq 0) 'Last-unit stock'
Write-Output 'PASS last-unit oversell prevention'
$before=Num 'SELECT count(*) FROM public.orders'
$r=Race (Order $a @(102) '30000000-0000-0000-0000-000000000103') (Order $b @(102) '30000000-0000-0000-0000-000000000104') 2
Assert ($r[0].result.order_id -ne $r[1].result.order_id) 'Distinct orders expected'
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+2) 'Two-order count'
Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=102') -eq 0) 'Two-order stock'
Write-Output 'PASS concurrent order creation and exact stock decrement'
$before=Num 'SELECT count(*) FROM public.orders'
Race (Order $a @(103) '30000000-0000-0000-0000-000000000105' 'GATE_ONCE' 140000) (Order $b @(103) '30000000-0000-0000-0000-000000000106' 'GATE_ONCE' 140000) 1 'invalid_coupon' | Out-Null
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+1) 'Global coupon order count'
Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=103') -eq 1) 'Global coupon stock'
Assert ((Num "SELECT used_count FROM public.coupons WHERE code='GATE_ONCE'") -eq 1) 'Global coupon count'
Write-Output 'PASS concurrent global coupon cap'
$before=Num 'SELECT count(*) FROM public.orders'
Race (Order $a @(104) '30000000-0000-0000-0000-000000000107' 'GATE_PER_USER' 140000) (Order $a @(104) '30000000-0000-0000-0000-000000000108' 'GATE_PER_USER' 140000) 1 'invalid_coupon' | Out-Null
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+1) 'Per-user coupon order count'
Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=104') -eq 1) 'Per-user coupon stock'
Assert ((Num "SELECT count(*) FROM public.coupon_usages u JOIN public.coupons c ON c.id=u.coupon_id WHERE c.code='GATE_PER_USER' AND u.user_id='$a'") -eq 1) 'Per-user coupon use count'
Write-Output 'PASS concurrent per-user coupon cap'
$before=Num 'SELECT count(*) FROM public.orders'
$same=Order $a @(105) '30000000-0000-0000-0000-000000000109'
$r=Race $same $same 2
Assert ($r[0].result.order_id -eq $r[1].result.order_id) 'Idempotent replay order IDs'
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+1) 'Replay order count'
Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=105') -eq 1) 'Replay stock'
Write-Output 'PASS concurrent idempotent replay'
$before=Num 'SELECT count(*) FROM public.orders'
Race (Order $a @(106) '30000000-0000-0000-0000-000000000110') (Order $a @(107) '30000000-0000-0000-0000-000000000110') 1 'idempotency_conflict' | Out-Null
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+1) 'Conflicting key order count'
Assert ((Num 'SELECT sum(stock) FROM public.product_sellers WHERE id IN (106,107)') -eq 3) 'Conflicting key stock'
Write-Output 'PASS concurrent conflicting idempotency payload'
$before=Num 'SELECT count(*) FROM public.orders'
Race (Order $a @(108,109) '30000000-0000-0000-0000-000000000111') (Order $b @(109,108) '30000000-0000-0000-0000-000000000112') 2 | Out-Null
Assert ((Num 'SELECT count(*) FROM public.orders') -eq $before+2) 'Reverse-order count'
Assert ((Num 'SELECT sum(stock) FROM public.product_sellers WHERE id IN (108,109)') -eq 0) 'Reverse-order stock'
Write-Output 'PASS reverse-item lock ordering without deadlock'

# Explicitly hold the last-unit Offer lock until both independent checkout sessions are waiting.
Query "INSERT INTO public.product_sellers(id,product_id,seller_id,seller_name,price,stock) VALUES(110,1,'$seller','Seller',100000,1);" | Out-Null
$holder=Start-Job -ScriptBlock { & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U mycar_gate1 -d mycar_gate1 -At -q -c 'BEGIN; SELECT id FROM public.product_sellers WHERE id=110 FOR UPDATE; SELECT pg_sleep(12); COMMIT;' | Out-Null }
$lockJobs=@()
try {
  Start-Sleep -Seconds 2
  $lockQueries=@((Order $a @(110) '30000000-0000-0000-0000-000000000113'),(Order $b @(110) '30000000-0000-0000-0000-000000000114'))
  $lockJobs=@($lockQueries | ForEach-Object { $sql=$_; Start-Job -ArgumentList $sql -ScriptBlock { param($statement); $lines=& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U mycar_gate1 -d mycar_gate1 -At -q -c $statement 2>&1; [pscustomobject]@{code=$LASTEXITCODE;lines=@($lines|ForEach-Object{[string]$_})} } })
  $maxWaiters=0
  for($i=0;$i -lt 24;$i++){ $n=[int](Num "SELECT count(*) FROM pg_stat_activity WHERE datname='mycar_gate1' AND wait_event_type='Lock' AND query LIKE '%place_order%'"); if($n -gt $maxWaiters){$maxWaiters=$n}; if($maxWaiters -ge 2){break}; Start-Sleep -Milliseconds 250 }
  $done=@($lockJobs|Wait-Job -Timeout 30); Assert ($done.Count -eq 2) 'Locked checkouts timed out'
  $lockResults=@($lockJobs|ForEach-Object{Receive-Job $_})
  Assert ($maxWaiters -ge 2) 'Two simultaneous PostgreSQL lock waits were not observed'
  Assert (($lockResults|Where-Object code -eq 0).Count -eq 1) 'Locked last-unit checkout result mismatch'
  Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=110') -eq 0) 'Locked last-unit stock mismatch'
  Write-Output 'PASS two independent sessions waited on the same Offer lock; one last-unit checkout committed'
} finally { if($lockJobs){$lockJobs|Remove-Job -Force}; $holder|Wait-Job -Timeout 20|Out-Null; Remove-Job $holder -Force }

# Competing cancellations restore the same order stock exactly once.
$orderId=[long](Query "SELECT id FROM public.orders WHERE user_id='$a' AND checkout_key='30000000-0000-0000-0000-000000000109'")
$cancelSql="SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$a',false); SELECT public.cancel_order($orderId); SELECT pg_backend_pid();"
$cancelJobs=@(1,2|ForEach-Object{Start-Job -ArgumentList $cancelSql -ScriptBlock{param($statement);$lines=& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U mycar_gate1 -d mycar_gate1 -At -q -c $statement 2>&1;[pscustomobject]@{code=$LASTEXITCODE;lines=@($lines|ForEach-Object{[string]$_})}}})
try{$done=@($cancelJobs|Wait-Job -Timeout 25);Assert($done.Count -eq 2)'Cancellation timed out';$cancelResults=@($cancelJobs|ForEach-Object{Receive-Job $_})}finally{$cancelJobs|Remove-Job -Force}
Assert (($cancelResults|Where-Object code -ne 0).Count -eq 0) 'Concurrent cancellation failed'
Assert (($cancelResults|ForEach-Object{$_.lines[-1]}|Select-Object -Unique).Count -eq 2) 'Cancellation sessions were not independent'
Assert ((Num 'SELECT stock FROM public.product_sellers WHERE id=105') -eq 2) 'Cancellation restored stock more than once'
Assert ((Query "SELECT status FROM public.orders WHERE id=$orderId") -eq 'cancelled') 'Concurrent cancellation did not cancel the order'
Write-Output 'PASS concurrent cancellation restores stock exactly once'
