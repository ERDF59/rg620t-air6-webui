#include "ql_nw.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int ql_nw_init(int mode) { assert(mode==NW_IPC_MODE_DEFAULT); return 0; }
int ql_nw_release(void) { puts("released"); return 0; }
int ql_nw_cell_band_scan(ql_nw_cell_band_scan_mode_req_t *r, void (*cb)(ql_nw_cell_band_scan_result_list_info_t *))
{
	const char *scenario=getenv("SCAN_FAKE");
	ql_nw_cell_band_scan_result_list_info_t result={
		.cell_band_result=r->mode?QL_NW_ASYNC_SUCCESS:QL_NW_ASYNC_ABORT,
		.nr_band_count=255,
		.nr_cell_band_info={{.cell_band=78,.arfcn=636666,.pci=0,.rsrp=-401,.rsrq=-39,.snr=48,.cid=UINT64_C(987654321012345678)}},
	};
	if (r->mode) {
		assert(r->mode==1 && r->timeout>0 && r->scan_type==1 && r->cell_rat==1);
		puts("started");
		if (!strcmp(scenario,"complete")) cb(&result);
	} else {
		assert(r->timeout==0 && r->scan_type==0 && r->cell_rat==0);
		puts("abort");
		if (!strcmp(scenario,"cancel")) cb(&result);
	}
	fflush(stdout);
	return 0;
}
