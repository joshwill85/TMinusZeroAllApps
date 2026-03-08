"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseAdminClient = createSupabaseAdminClient;
var supabase_js_2_1 = require("https://esm.sh/@supabase/supabase-js@2");
function createSupabaseAdminClient() {
    var url = Deno.env.get('SUPABASE_URL') ||
        Deno.env.get('SUPABASE_PROJECT_URL') ||
        Deno.env.get('SUPABASE_API_URL');
    var serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SERVICE_ROLE_KEY for Edge Function.');
    }
    return (0, supabase_js_2_1.createClient)(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}
