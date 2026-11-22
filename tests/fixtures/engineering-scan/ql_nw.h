/* Minimal behavioral double, deliberately not an SDK header. */
#pragma once
#include <stdint.h>
enum { NW_IPC_MODE_DEFAULT, QL_NW_ASYNC_SUCCESS=0, QL_NW_ASYNC_ABORT=1, QL_NW_ASYNC_FAIL=2 };
typedef struct { int mode,timeout,scan_type,cell_rat; } ql_nw_cell_band_scan_mode_req_t;
typedef struct { uint16_t cell_band; uint32_t arfcn,pci; int32_t rsrp,rsrq,snr; uint64_t cid; } ql_nw_cell_band_info_t;
typedef struct {
	int cell_band_result;
	unsigned lte_band_count,nr_band_count;
	ql_nw_cell_band_info_t lte_cell_band_info[2],nr_cell_band_info[2];
} ql_nw_cell_band_scan_result_list_info_t;
int ql_nw_init(int mode);
int ql_nw_release(void);
int ql_nw_cell_band_scan(ql_nw_cell_band_scan_mode_req_t *, void (*cb)(ql_nw_cell_band_scan_result_list_info_t *));
