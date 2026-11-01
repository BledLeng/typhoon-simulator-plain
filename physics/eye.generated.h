#include <math.h>
#include <stdint.h>
#ifndef FLAQ_REAL_HELPERS
#define FLAQ_REAL_HELPERS
static inline double flaq_real_min(double a,double b){return a<b?a:b;}
static inline double flaq_real_max(double a,double b){return a>b?a:b;}
static inline double flaq_real_abs(double a){return a<0?-a:a;}
#endif
static inline double flaq_eyeRamp(double arg_lo, double arg_hi, double arg_value) { double arg_t = flaq_real_min(1.0, flaq_real_max(0.0, ((arg_value - arg_lo) / (arg_hi - arg_lo)))); return ((arg_t * arg_t) * (3.0 - (2.0 * arg_t))); }
static inline double flaq_eyeTarget(double arg_wind, double arg_warm, double arg_organization, double arg_shear, double arg_humidity, double arg_symmetry, double arg_cover, double arg_dry, double arg_tropical, double arg_replacement, double arg_trend, double arg_existing) { double arg_wall = flaq_eyeRamp(0.42, 0.90, arg_symmetry); double arg_clear = (1.0 - flaq_eyeRamp(0.25, 1.65, arg_cover)); double arg_thermal = (flaq_eyeRamp(0.23, 0.65, arg_warm) * flaq_eyeRamp(0.45, 0.75, arg_organization)); double arg_environment = (((1.0 - flaq_eyeRamp(8.0, 23.0, arg_shear)) * flaq_eyeRamp(55.0, 85.0, arg_humidity)) * (1.0 - (0.65 * arg_dry))); double arg_early = (flaq_eyeRamp(36.0, 48.0, arg_wind) * (0.16 + (0.84 * flaq_real_max(flaq_eyeRamp(12.0, 35.0, arg_trend), flaq_eyeRamp(0.4, 0.8, arg_existing))))); double arg_intensity = flaq_real_max(arg_early, flaq_eyeRamp(45.0, 55.0, arg_wind)); return ((((((arg_intensity * arg_thermal) * arg_environment) * arg_wall) * arg_clear) * arg_tropical) * arg_replacement); }
static inline double flaq_eyeTrend(double arg_previous, double arg_change, double arg_dt) { double arg_ktPerDay = (((arg_change * (3600.0 / 1852.0)) * 24.0) / flaq_real_max(0.000001, arg_dt)); return (arg_previous + ((arg_ktPerDay - arg_previous) * (1.0 - exp(((-arg_dt) / 6.0))))); }
