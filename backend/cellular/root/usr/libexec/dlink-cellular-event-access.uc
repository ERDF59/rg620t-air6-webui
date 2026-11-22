import { stdin } from 'fs';
import { connect } from 'ubus';

const request = stdin.read(36);
if (type(request) != 'string' || length(request) != 35 || !match(request, /^[0-9a-f]{32}:[N-][S-]$/))
	exit(1);
const sid = substr(request, 0, 32);
if (sid == '00000000000000000000000000000000')
	exit(1);

const bus = connect(null, 2);
if (!bus)
	exit(1);
function allow(method) {
	const reply = bus.call('session', 'access', {
		ubus_rpc_session: sid, scope: 'ubus', object: 'dlink-cellular', function: method
	});
	return reply?.access === true;
}
// No token in the URL, command arguments, or emitted events.
print((substr(request, 33, 1) == 'N' && allow('overview') ? 'N' : '-') +
      (substr(request, 34, 1) == 'S' && allow('events_sms') ? 'S' : '-'));
