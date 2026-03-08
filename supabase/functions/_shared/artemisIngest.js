"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTEMIS_SOURCE_KEYS = void 0;
exports.jsonResponse = jsonResponse;
exports.stringifyError = stringifyError;
exports.toIsoOrNull = toIsoOrNull;
exports.classifyMission = classifyMission;
exports.startIngestionRun = startIngestionRun;
exports.finishIngestionRun = finishIngestionRun;
exports.updateCheckpoint = updateCheckpoint;
exports.loadCheckpoints = loadCheckpoints;
exports.isBootstrapComplete = isBootstrapComplete;
exports.setSystemSetting = setSystemSetting;
exports.readSystemSetting = readSystemSetting;
exports.readBooleanSetting = readBooleanSetting;
exports.readNumberSetting = readNumberSetting;
exports.readStringSetting = readStringSetting;
exports.readDailyQuotaWindow = readDailyQuotaWindow;
exports.claimDailyQuota = claimDailyQuota;
exports.insertSourceDocument = insertSourceDocument;
exports.upsertTimelineEvent = upsertTimelineEvent;
exports.ARTEMIS_SOURCE_KEYS = [
    'nasa_campaign_pages',
    'nasa_blog_posts',
    'nasa_reference_timelines',
    'nasa_rss',
    'oig_reports',
    'gao_reports',
    'moon_to_mars_docs',
    'ntrs_api',
    'techport_api',
    'nasa_budget_docs',
    'usaspending_awards',
    'nasa_media_assets'
];
function jsonResponse(payload, status) {
    if (status === void 0) { status = 200; }
    return new Response(JSON.stringify(payload), {
        status: status,
        headers: { 'Content-Type': 'application/json' }
    });
}
function stringifyError(err) {
    if (err instanceof Error)
        return err.message;
    if (typeof err === 'string')
        return err;
    if (err && typeof err === 'object') {
        var anyErr = err;
        var message = typeof anyErr.message === 'string' ? anyErr.message : null;
        var details = typeof anyErr.details === 'string' ? anyErr.details : null;
        var hint = typeof anyErr.hint === 'string' ? anyErr.hint : null;
        var code = typeof anyErr.code === 'string' ? anyErr.code : null;
        var status_1 = typeof anyErr.status === 'number'
            ? String(anyErr.status)
            : typeof anyErr.status === 'string'
                ? anyErr.status
                : null;
        var name_1 = typeof anyErr.name === 'string' ? anyErr.name : null;
        var parts = [message, details, hint].filter(Boolean).join(' • ');
        var prefix = [name_1, code, status_1].filter(Boolean).join(':');
        if (parts)
            return prefix ? "".concat(prefix, ": ").concat(parts) : parts;
        try {
            return JSON.stringify(err);
        }
        catch (_a) {
            // fall through
        }
    }
    return String(err);
}
function toIsoOrNull(value) {
    if (typeof value !== 'string')
        return null;
    var date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toISOString();
}
function classifyMission(nameLike) {
    var value = (nameLike || '').toLowerCase();
    if (/\bartemis\s*(vii|7)\b/.test(value))
        return 'artemis-vii';
    if (/\bartemis\s*(vi|6)\b/.test(value))
        return 'artemis-vi';
    if (/\bartemis\s*(v|5)\b/.test(value))
        return 'artemis-v';
    if (/\bartemis\s*(iv|4)\b/.test(value))
        return 'artemis-iv';
    if (/\bartemis\s*(ii|2)\b/.test(value))
        return 'artemis-ii';
    if (/\bartemis\s*(iii|3)\b/.test(value))
        return 'artemis-iii';
    if (/\bartemis\s*(i|1)\b/.test(value))
        return 'artemis-i';
    return 'program';
}
function startIngestionRun(supabase, jobName) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('ingestion_runs')
                        .insert({ job_name: jobName, started_at: new Date().toISOString(), success: false })
                        .select('id')
                        .single()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error || !(data === null || data === void 0 ? void 0 : data.id))
                        throw error || new Error("Failed to start ingestion run for ".concat(jobName));
                    return [2 /*return*/, { runId: data.id }];
            }
        });
    });
}
function finishIngestionRun(supabase, runId, success, stats, errorMessage) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('ingestion_runs')
                        .update({
                        success: success,
                        ended_at: new Date().toISOString(),
                        stats: stats || null,
                        error: errorMessage || null
                    })
                        .eq('id', runId)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function updateCheckpoint(supabase, sourceKey, patch) {
    return __awaiter(this, void 0, void 0, function () {
        var payload, error;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    payload = {
                        source_key: sourceKey,
                        source_type: patch.sourceType || 'nasa_primary',
                        updated_at: new Date().toISOString()
                    };
                    if (patch.status)
                        payload.status = patch.status;
                    if ('cursor' in patch)
                        payload.cursor = patch.cursor;
                    if (typeof patch.recordsIngested === 'number')
                        payload.records_ingested = patch.recordsIngested;
                    if ('lastAnnouncedTime' in patch)
                        payload.last_announced_time = patch.lastAnnouncedTime;
                    if ('lastEventTime' in patch)
                        payload.last_event_time = patch.lastEventTime;
                    if ('startedAt' in patch)
                        payload.started_at = patch.startedAt;
                    if ('endedAt' in patch)
                        payload.ended_at = patch.endedAt;
                    if ('lastError' in patch)
                        payload.last_error = patch.lastError;
                    if (patch.metadata)
                        payload.metadata = patch.metadata;
                    return [4 /*yield*/, supabase.from('artemis_ingest_checkpoints').upsert(payload, { onConflict: 'source_key' })];
                case 1:
                    error = (_a.sent()).error;
                    if (error)
                        throw error;
                    return [2 /*return*/];
            }
        });
    });
}
function loadCheckpoints(supabase) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('artemis_ingest_checkpoints')
                        .select('source_key, source_type, status, cursor, records_ingested, last_announced_time, last_event_time, last_error, updated_at')
                        .order('source_key', { ascending: true })];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, data || []];
            }
        });
    });
}
function isBootstrapComplete(supabase) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('artemis_ingest_checkpoints')
                        .select('status')
                        .neq('status', 'complete')
                        .limit(1)];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, !data || data.length === 0];
            }
        });
    });
}
function setSystemSetting(supabase, key, value) {
    return __awaiter(this, void 0, void 0, function () {
        var error;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('system_settings')
                        .upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' })];
                case 1:
                    error = (_a.sent()).error;
                    if (error)
                        throw error;
                    return [2 /*return*/];
            }
        });
    });
}
function readSystemSetting(supabase, key) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase.from('system_settings').select('value').eq('key', key).maybeSingle()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, data === null || data === void 0 ? void 0 : data.value];
            }
        });
    });
}
function readBooleanSetting(supabase, key, fallback) {
    return __awaiter(this, void 0, void 0, function () {
        var value;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, readSystemSetting(supabase, key)];
                case 1:
                    value = _a.sent();
                    if (typeof value === 'boolean')
                        return [2 /*return*/, value];
                    if (typeof value === 'string')
                        return [2 /*return*/, value.toLowerCase() === 'true'];
                    return [2 /*return*/, fallback];
            }
        });
    });
}
function readNumberSetting(supabase, key, fallback) {
    return __awaiter(this, void 0, void 0, function () {
        var value, parsed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, readSystemSetting(supabase, key)];
                case 1:
                    value = _a.sent();
                    if (typeof value === 'number' && Number.isFinite(value))
                        return [2 /*return*/, value];
                    if (typeof value === 'string') {
                        parsed = Number(value);
                        if (Number.isFinite(parsed))
                            return [2 /*return*/, parsed];
                    }
                    return [2 /*return*/, fallback];
            }
        });
    });
}
function readStringSetting(supabase_1, key_1) {
    return __awaiter(this, arguments, void 0, function (supabase, key, fallback) {
        var value, trimmed;
        if (fallback === void 0) { fallback = ''; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, readSystemSetting(supabase, key)];
                case 1:
                    value = _a.sent();
                    if (typeof value === 'string') {
                        trimmed = value.trim();
                        return [2 /*return*/, trimmed.length ? trimmed : fallback];
                    }
                    if (typeof value === 'number' && Number.isFinite(value)) {
                        return [2 /*return*/, String(value)];
                    }
                    return [2 /*return*/, fallback];
            }
        });
    });
}
function readDailyQuotaWindow(supabase, options) {
    return __awaiter(this, void 0, void 0, function () {
        var today, limit, _a, _b, _c, _d, _e, reserve, _f, _g, _h, _j, _k, rawState, state, used, maxUsable, available;
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    today = new Date().toISOString().slice(0, 10);
                    _b = (_a = Math).max;
                    _c = [0];
                    _e = (_d = Math).trunc;
                    return [4 /*yield*/, readNumberSetting(supabase, options.limitKey, options.defaultLimit)];
                case 1:
                    limit = _b.apply(_a, _c.concat([_e.apply(_d, [_l.sent()])]));
                    _g = (_f = Math).max;
                    _h = [0];
                    _k = (_j = Math).trunc;
                    return [4 /*yield*/, readNumberSetting(supabase, options.reserveKey, options.defaultReserve)];
                case 2:
                    reserve = _g.apply(_f, _h.concat([_k.apply(_j, [_l.sent()])]));
                    return [4 /*yield*/, readSystemSetting(supabase, options.stateKey)];
                case 3:
                    rawState = _l.sent();
                    state = coerceQuotaState(rawState);
                    used = state.date === today ? state.used : 0;
                    maxUsable = Math.max(0, limit - reserve);
                    available = Math.max(0, maxUsable - used);
                    return [2 /*return*/, {
                            date: today,
                            used: used,
                            limit: limit,
                            reserve: reserve,
                            maxUsable: maxUsable,
                            available: available,
                            remaining: available,
                            stateKey: options.stateKey
                        }];
            }
        });
    });
}
function claimDailyQuota(supabase, options) {
    return __awaiter(this, void 0, void 0, function () {
        var requested, window, usedBaseline, available, granted, used, remaining;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    requested = Math.max(0, Math.trunc((_a = options.requested) !== null && _a !== void 0 ? _a : 1));
                    return [4 /*yield*/, readDailyQuotaWindow(supabase, {
                            stateKey: options.stateKey,
                            limitKey: options.limitKey,
                            reserveKey: options.reserveKey,
                            defaultLimit: options.defaultLimit,
                            defaultReserve: options.defaultReserve
                        })];
                case 1:
                    window = _b.sent();
                    usedBaseline = window.used;
                    available = window.available;
                    granted = Math.min(requested, available);
                    used = usedBaseline + granted;
                    remaining = Math.max(0, window.maxUsable - used);
                    return [4 /*yield*/, setSystemSetting(supabase, options.stateKey, {
                            date: window.date,
                            used: used,
                            limit: window.limit,
                            reserve: window.reserve,
                            updatedAt: new Date().toISOString()
                        })];
                case 2:
                    _b.sent();
                    return [2 /*return*/, {
                            date: window.date,
                            requested: requested,
                            granted: granted,
                            used: used,
                            limit: window.limit,
                            reserve: window.reserve,
                            available: available,
                            remaining: remaining,
                            stateKey: options.stateKey
                        }];
            }
        });
    });
}
function coerceQuotaState(value) {
    if (!value || typeof value !== 'object') {
        return { date: null, used: 0 };
    }
    var state = value;
    var date = typeof state.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.date) ? state.date : null;
    var used = 0;
    if (typeof state.used === 'number' && Number.isFinite(state.used)) {
        used = Math.max(0, Math.trunc(state.used));
    }
    else if (typeof state.used === 'string') {
        var parsed = Number(state.used);
        if (Number.isFinite(parsed))
            used = Math.max(0, Math.trunc(parsed));
    }
    return { date: date, used: used };
}
function insertSourceDocument(supabase, input) {
    return __awaiter(this, void 0, void 0, function () {
        var payload, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    payload = {
                        source_key: input.sourceKey,
                        source_type: input.sourceType,
                        url: input.url,
                        title: input.title || null,
                        summary: input.summary || null,
                        published_at: input.publishedAt || null,
                        announced_time: input.announcedTime || null,
                        fetched_at: new Date().toISOString(),
                        http_status: input.httpStatus || null,
                        content_type: input.contentType || null,
                        parse_version: input.parseVersion || 'v1',
                        raw: input.raw || null,
                        error: input.error || null,
                        updated_at: new Date().toISOString()
                    };
                    return [4 /*yield*/, supabase
                            .from('artemis_source_documents')
                            .insert(payload)
                            .select('id')
                            .single()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error || !(data === null || data === void 0 ? void 0 : data.id))
                        throw error || new Error('failed_to_insert_artemis_source_document');
                    return [2 /*return*/, data.id];
            }
        });
    });
}
function upsertTimelineEvent(supabase, input) {
    return __awaiter(this, void 0, void 0, function () {
        var row, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    row = {
                        fingerprint: input.fingerprint,
                        mission_key: input.missionKey,
                        title: input.title,
                        summary: input.summary || null,
                        event_time: input.eventTime || null,
                        event_time_precision: input.eventTimePrecision || 'unknown',
                        announced_time: input.announcedTime,
                        source_type: input.sourceType,
                        confidence: input.confidence,
                        source_document_id: input.sourceDocumentId,
                        source_url: input.sourceUrl || null,
                        supersedes_event_id: input.supersedesEventId || null,
                        tags: input.tags || [],
                        metadata: input.metadata || {},
                        updated_at: new Date().toISOString()
                    };
                    return [4 /*yield*/, supabase.from('artemis_timeline_events').upsert(row, { onConflict: 'fingerprint' }).select('id').single()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error || !(data === null || data === void 0 ? void 0 : data.id))
                        throw error || new Error('failed_to_upsert_artemis_timeline_event');
                    return [2 /*return*/, data.id];
            }
        });
    });
}
