/* Feed the same native cell enumeration used by the overview RPC. No physical modem. */
#define main modem_cli_main
#include "../backend/cellular/src/dlink-cell.c"
#undef main
int ql_nw_get_cell_info(ql_nw_cell_info_t *c) {
 c->nr_info_valid=c->lte_info_valid=1;
 c->nr_info_len=3; c->lte_info_len=2;
 c->nr_info[0]=(ql_nw_nr_info_t){.nr_arfcn=633984,.pci=10,.rsrp=-105,.rsrq=-11,.sinr=10,.ta=0};
 c->nr_info[1]=(ql_nw_nr_info_t){.nr_arfcn=633984,.pci=335,.rsrp=-110,.rsrq=-17,.sinr=-4,.ta=90};
 c->nr_info[2]=(ql_nw_nr_info_t){.nr_arfcn=176190,.pci=20,.rsrp=-98,.rsrq=INT32_MAX,.sinr=INT32_MAX};
 c->lte_info[0]=(ql_nw_lte_info_t){.earfcn=1650,.pci=0,.rsrp=-92,.rsrq=-10,.sinr=0,.ta=17};
 c->lte_info[1]=(ql_nw_lte_info_t){.earfcn=1650,.pci=17,.rsrp=-96,.rsrq=-12,.sinr=37};
 if (getenv("TA_MISSING")) { c->nr_info[0].ta=UINT32_MAX; c->lte_info[0].ta=INT32_MAX; }
 return 0;
}
int ql_nw_get_signal_strength(ql_nw_signal_strength_info_t *s,QL_NW_SIGNAL_STRENGTH_LEVEL_E *l){(void)s;(void)l;return -1;}
int ql_nw_get_data_reg_status(ql_nw_reg_status_info_t *r){(void)r;return -1;}
int ql_nw_get_ca_info(ql_nw_get_ca_info_resp_t *c){(void)c;return -1;}
int ql_nw_get_band_info(ql_nw_get_band_info_t *b){(void)b;return -1;}
int main(void){overview(1);return 0;}
