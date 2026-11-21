BEGIN { FS="," }
function field(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s; }
function unquote(s) { s = field(s); gsub(/^"|"$/, "", s); return s }
{
	sub(/\r$/, "")
	if ($0 == "OK") ok = 1
	if ($0 ~ /^(ERROR|[+]CME ERROR|NO CARRIER|BUSY|NO ANSWER|NO DIALTONE)/) failed = 1
	if (query == "calls" && $0 ~ /^[+]CLCC:/) {
		id = $1
		sub(/^[+]CLCC:[[:space:]]*/, "", id)
		id = field(id)
		dir = field($2)
		state = field($3)
		kind = field($4)
		if (NF < 5 || id !~ /^[0-9][0-9]?[0-9]?$/ || id + 0 > 255 ||
		    dir !~ /^[01]$/ || state !~ /^[0-9]$/ || kind !~ /^[0-9][0-9]?[0-9]?$/ ||
		    (id + 0) in seen || count >= 24) {
			failed = 1
			next
		}
		seen[id + 0] = 1
		n = ""
		for (i = 5; i <= NF; i++) {
			if ($i ~ /^[[:space:]]*"/) { n = unquote($i); break }
		}
		if (n !~ /^[+]?[0-9]+$/ || length(n) > 16) n = ""
		rows[++count] = (id + 0) ":" dir ":" state ":" (kind + 0) ":" n ((kind == "20" && field($5) == "0") ? ":v" : "")
	}
}
END {
	if (!ok || failed) exit 1
	for (i = 1; i <= count; i++) print rows[i]
}
