# Strictly decode the factory CLI's MIPC_CALL_GET_CALL_STATUS response.
# Not interchangeable with CLCC indices. Do not read telephone numbers here.
{ gsub(/\r/,""); buf=buf $0 " " }
END {
	sub(/^[[:space:]]+/,"",buf)
	if (!match(buf,/^result:0,count:[0-9]+[[:space:]]/)) exit 1
	expected=substr(buf,16,RLENGTH-16)+0
	if (expected>24) exit 1
	buf=substr(buf,RLENGTH+1)
	sub(/^[[:space:]]+/,"",buf)
	while (length(buf)) {
		if (!match(buf,/^call_id\[[0-9]+\]:[0-9]+,call_state\[[0-9]+\]:[0-5],/)) exit 1
		row=substr(buf,1,RLENGTH)
		buf=substr(buf,RLENGTH+1)
		sub(/^[[:space:]]+/,"",buf)
		split(row, chunk, ",")
		gsub(/[^0-9]+/, " ", chunk[1]); split(chunk[1], a, " ")
		gsub(/[^0-9]+/, " ", chunk[2]); split(chunk[2], b, " ")
		if (a[1]+0!=n || b[1]+0!=n || a[2]+0>4294967294 || (a[2]+0) in seen) exit 1
		seen[a[2]+0]=1
		list[++n]=sprintf("%.0f:%d", a[2]+0, b[2]+0)
	}
	if (n+0!=expected) exit 1
	print "count:" expected
	for (i=1;i<=n;i++) print list[i]
}
