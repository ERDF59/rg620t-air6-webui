# Return only safe, deduplicated values from the fixed QoS queries.
BEGIN { FS="," }
{
	sub(/\r$/, "")
	# AT replies without a successful final result must not be used.
	if ($0=="OK") ready=1
	if (mode=="contexts" && $1 ~ /^[+]CGCONTRDP:/ && NF>=3) {
		cid=$1; sub(/^[+]CGCONTRDP:[[:space:]]*/,"",cid)
		apn=$3; gsub(/^[[:space:]"]+|[[:space:]"]+$/,"",apn)
		if (raw!=1) {
			apn=tolower(apn)
			sub(/[.]mnc[0-9][0-9][0-9][.]mcc[0-9][0-9][0-9][.]gprs$/,"",apn)
		}
		if (cid !~ /^(0|[1-9][0-9]?)$/ || cid+0>63 || apn !~ /^[A-Za-z0-9._-]+$/ || length(apn)>100 || cid in seen || n>=8) next
		seen[cid]=1
		out[++n]=cid ":" apn
	}
	if (mode=="classes" && index($1, "+" verb ":")==1 && NF>=2) {
		cid=$1; sub(/^[+][A-Z0-9]+:[[:space:]]*/,"",cid)
		class=$2; gsub(/^[[:space:]]+|[[:space:]]+$/,"",class)
		if (cid!=id || class !~ /^[0-9][0-9]?[0-9]?$/ || class+0<1 || class+0>254 || (class+0) in seen) next
		seen[class+0]=1
		out[++n]=class+0
	}
}
END {
	if (!ready) exit
	for (i=1;i<=n;i++) printf "%s%s",out[i],(mode=="contexts" ? "\n" : (i<n ? "," : "\n"))
}
