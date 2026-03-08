-- Seed wx_v2_lcc default config (non-destructive; skips if already set to a different model).
insert into public.system_settings (key, value)
values (
  'weather_model',
  '{
    "model_version": "wx_v2_lcc",
    "z_ref_m": 10,
    "z_tower_m": 49,
    "z0_roughness_m": 0.05,
    "v_mid_kts": 25,
    "v_limit_kts": 30,
    "k_w": 0.45,
    "gust_ok_kts": 20,
    "gust_limit_kts": 35,
    "gust_hard_enabled": true,
    "lal_hard_cutoff": 4,
    "rh_cloud_threshold": 90,
    "thick_cloud_ft": 4500,
    "use_vertical_profiles": false,
    "shear_enabled": false,
    "shear_ref": 15,
    "shear_hard": 25,
    "temp_low_ok_f": 40,
    "temp_low_limit_f": 25,
    "temp_soak_limit_f": 20,
    "temp_low_range_f": 10,
    "temp_high_ok_f": 85,
    "temp_high_limit_f": 95,
    "temp_high_range_f": 8,
    "recovery_enabled": false,
    "wave_ok_m": 1.5,
    "wave_limit_m": 2.5,
    "deckwind_mid_kts": 20,
    "deckwind_k": 0.35,
    "weights": { "wind": 1.0, "gust": 0.8, "elec": 1.2, "shear": 1.0, "temp": 0.7, "recovery": 0.8 },
    "marginal_cutoff_go": 80,
    "riskword_min_impact": 0.15
  }'::jsonb
)
on conflict (key) do nothing;
