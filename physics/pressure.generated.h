#include <math.h>
#include <stdint.h>
#ifndef FLAQ_REAL_HELPERS
#define FLAQ_REAL_HELPERS
static inline double flaq_real_min(double a,double b){return a<b?a:b;}
static inline double flaq_real_max(double a,double b){return a>b?a:b;}
static inline double flaq_real_abs(double a){return a<0?-a:a;}
#endif
static inline double flaq_deficit(double arg_speed, double arg_latitude, double arg_u, double arg_v, double arg_radius, double arg_rmw, double arg_transition) { double arg_wind = (flaq_real_max(0.0, arg_speed) * (3600.0 / 1852.0)); double arg_lat = flaq_real_min(55.0, flaq_real_abs(arg_latitude)); double arg_relative = flaq_real_max(0.0, (arg_wind - (1.5 * pow((hypot(arg_u, arg_v) / 1.852), 0.63)))); double arg_cr = flaq_real_max(8.0, ((66.785 - (0.09102 * arg_wind)) + (1.0619 * (arg_lat - 25.0)))); double arg_exponent = flaq_real_max(0.15, ((0.1147 + (0.0055 * arg_wind)) - (0.001 * (arg_lat - 25.0)))); double arg_normal = flaq_real_max(0.1, (arg_wind * pow((arg_cr / 500.0), arg_exponent))); double arg_size = flaq_real_max(30.0, arg_radius); double arg_v500 = ((arg_wind * pow(flaq_real_min(1.0, (arg_rmw / 500.0)), 0.65)) * exp(((-250000.0) / ((2.0 * arg_size) * arg_size)))); double arg_rel = (arg_relative / 24.254); double arg_mature = flaq_real_max(0.0, (((((-23.286) + (0.483 * arg_relative)) + (arg_rel * arg_rel)) + (12.587 * flaq_real_min(2.0, flaq_real_max(0.1, (arg_v500 / arg_normal))))) + (0.483 * arg_lat))); double arg_weak = (0.013 * pow((flaq_real_max(0.0, arg_speed) * 3.6), 1.55)); double arg_x = flaq_real_min(1.0, flaq_real_max(0.0, ((arg_wind - 30.0) / 34.0))); double arg_tropical = (((arg_x * arg_x) * (3.0 - (2.0 * arg_x))) * (1.0 - flaq_real_min(1.0, flaq_real_max(0.0, arg_transition)))); return (arg_weak + ((arg_mature - arg_weak) * arg_tropical)); }
