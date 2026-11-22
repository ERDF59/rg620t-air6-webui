/*
 * Exercise the shipped helper against a controlled SDK double.
 * Build on the matching SDK host with native cc, vendor headers, -ffunction-sections -fdata-sections
 * and -Wl,--gc-sections. The main entry and other modem commands are not linked.
 */
#define main device_helper_main
#include "../backend/cellular/src/dlink-cell.c"
#undef main
#include <assert.h>

static int nr_value, lte_value, getter_calls, writes, never_apply;
int ql_nw_get_nr_4x4_mimo_mode(ql_nw_4x4_mimo_mode_t *mode) {
	mode->mode=nr_value;
	getter_calls++;
	return 0;
}
int ql_nw_get_lte_4x4_mimo_mode(ql_nw_4x4_mimo_mode_t *mode) {
	mode->mode=lte_value;
	getter_calls++;
	return 0;
}
int ql_nw_set_nr_4x4_mimo_mode(ql_nw_4x4_mimo_mode_t *mode) {
	writes++;
	if (!never_apply) nr_value=mode->mode;
	return 0;
}
int ql_nw_set_lte_4x4_mimo_mode(ql_nw_4x4_mimo_mode_t *mode) {
	writes++;
	lte_value=mode->mode;
	return 0;
}
int main(void)
{
	/* Accepting this configuration must not modify the other RAT. */
	mimo_set("NR","1");
	assert(nr_value==1 && lte_value==0 && writes==1 && getter_calls==2);
	mimo_set("LTE","0");
	assert(writes==1 && getter_calls==3);
	lte_value=-1;
	mimo_set("LTE","1");
	assert(writes==1 && getter_calls==4);
	never_apply=1;
	mimo_set("NR","0");
	assert(nr_value==1 && writes==2 && getter_calls==6);
	return 0;
}
