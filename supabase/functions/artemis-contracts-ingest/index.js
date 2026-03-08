"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var server_ts_1 = require("https://deno.land/std@0.224.0/http/server.ts");
var supabase_ts_1 = require("../_shared/supabase.ts");
var jobAuth_ts_1 = require("../_shared/jobAuth.ts");
var artemisIngest_ts_1 = require("../_shared/artemisIngest.ts");
var RUN_NAME = 'artemis_contracts_ingest';
var CHECKPOINT_NORMALIZED = 'artemis_contracts_normalized';
var CHECKPOINT_SAM_CONTRACT_AWARDS = 'sam_contract_awards';
var CHECKPOINT_OPPORTUNITIES = 'sam_opportunities';
var CHECKPOINT_SPENDING = 'usaspending_contract_spending';
var SETTING_CONTRACTS_JOB_ENABLED = 'artemis_contracts_job_enabled';
var SETTING_CONTRACTS_JOB_DISABLED_REASON = 'artemis_contracts_job_disabled_reason';
var SETTING_SAM_DISABLE_ON_GUARDRAIL = 'artemis_sam_disable_job_on_guardrail';
var SETTING_SAM_STOP_ON_EMPTY_OR_ERROR = 'artemis_sam_stop_on_empty_or_error';
var SETTING_SAM_PROBE_BOTH_ENDPOINTS_FIRST = 'artemis_sam_probe_both_endpoints_first';
var DEFAULT_BATCH_LIMIT = 2000;
var DEFAULT_LOOKBACK_DAYS = 365;
var DEFAULT_SAM_DAILY_LIMIT = 10;
var DEFAULT_SAM_DAILY_RESERVE = 0;
var DEFAULT_SAM_MAX_REQUESTS_PER_RUN = 10;
var SPENDING_ACTION_CONTRACT_ID_LIMIT = 1000;
var SPENDING_ACTION_CONTRACT_ID_CHUNK_SIZE = 200;
var SAM_CONTRACT_AWARDS_CANDIDATE_MULTIPLIER = 20;
var SAM_CONTRACT_AWARDS_LIMIT = 100;
var SAM_OPPORTUNITIES_LIMIT = 1000;
var SAM_OPPORTUNITIES_MAX_LOOKBACK_DAYS = 364;
var SAM_OPPORTUNITIES_MAX_WINDOW_DAYS = SAM_OPPORTUNITIES_MAX_LOOKBACK_DAYS;
var MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
var UPSERT_CHUNK_SIZE = 250;
var TARGET_SAM_PROGRAM_SCOPES = ['artemis', 'blue-origin', 'spacex'];
var KEYWORD_ALIGNMENT_RULES = [
    { lineToken: 'space launch system', contractTokens: ['space launch system', 'sls', 'core stage', 'exploration upper stage'], confidence: 0.92 },
    { lineToken: 'orion', contractTokens: ['orion', 'crew capsule', 'crew module', 'service module'], confidence: 0.92 },
    {
        lineToken: 'exploration ground systems',
        contractTokens: ['exploration ground systems', 'egs', 'mobile launcher', 'ground systems', 'vab'],
        confidence: 0.9
    },
    { lineToken: 'human landing system', contractTokens: ['human landing system', 'hls', 'lunar lander'], confidence: 0.93 },
    { lineToken: 'gateway', contractTokens: ['gateway', 'halo', 'ppe'], confidence: 0.91 },
    { lineToken: 'xeva', contractTokens: ['x-eva', 'xeva', 'extravehicular'], confidence: 0.88 },
    { lineToken: 'moon to mars', contractTokens: ['moon to mars', 'moon-to-mars'], confidence: 0.85 }
];
(0, server_ts_1.serve)(function (req) { return __awaiter(void 0, void 0, void 0, function () {
    var supabase, authorized, startedAt, runId, disableJobOnGuardrail, stats, enabled, stopOnEmptyOrError_1, probeBothEndpointsFirst, body, bodySamSessionToken_1, bodyRequestedSamMaxRequestsPerRun, bodySamSinglePassPerEndpoint, configuredMode, _a, mode, stage, configuredSamMaxRequestsPerRun, _b, _c, _d, _e, _f, samMaxRequestsPerRun, shouldReadProcurementRows, shouldMarkNormalizedRunning, nowIso, previousCursor, _g, procurementRows, _h, _j, _k, _l, _m, _o, _p, _q, normalized, contractRefs, _r, contractIdByKey, actions, actionCount, nextCursor, _s, _t, _u, mapped, _v, _w, _x, spendingRows, runSamContractAwards_1, runSamOpportunities_1, allowFallbackLookup_1, shouldProbeBothEndpoints, samApiKey_1, remainingSamRequests_1, samGuardrailTriggered_1, samGuardrailReason_1, targetedSolicitationIds_1, probeStopReasons_1, samContractAwardsStopReason_1, samOpportunitiesStopReason_1, stopReasonIsGuardrail_1, shouldStopSamRun_1, samStepTrace_1, getSamEndpointDecisions_1, pushSamStep_1, logSamEndpointDecision_1, requestedRunCap, quotaWindow, shouldTreatSamStopReasonAsGuardrail_1, getSamStopReasons_1, getSamProbeStopReasons, recordSamGuardrail_1, requestedRunCap, mergeLookupSource_1, applyContractAwardsResult_1, applyOpportunitiesResult_1, contractAwardsApiUrl_1, _y, opportunityApiUrl_1, _z, lookbackDays_1, _0, _1, _2, _3, _4, _5, _6, _7, _8, runContractAwardsPass, runOpportunitiesPass, singlePassPerEndpoint, probeRequiredEndpoints, requiredProbeRequests, probeStopReasonsList, initialAwardsRequests, initialOpportunitiesRequests, finalSamStopReason_1, runCapRequestedForInference, runCapBudgetForInference, runGrantedForInference, runRemainingForInference, finalSamStopReasons, hasGuardrailTrace, autoDisableReason, refreshDocId, err_1, message;
    var _9, _10, _11;
    return __generator(this, function (_12) {
        switch (_12.label) {
            case 0:
                supabase = (0, supabase_ts_1.createSupabaseAdminClient)();
                return [4 /*yield*/, (0, jobAuth_ts_1.requireJobAuth)(req, supabase)];
            case 1:
                authorized = _12.sent();
                if (!authorized)
                    return [2 /*return*/, (0, artemisIngest_ts_1.jsonResponse)({ error: 'unauthorized' }, 401)];
                startedAt = Date.now();
                return [4 /*yield*/, (0, artemisIngest_ts_1.startIngestionRun)(supabase, RUN_NAME)];
            case 2:
                runId = (_12.sent()).runId;
                disableJobOnGuardrail = true;
                stats = {
                    mode: 'incremental',
                    stage: 'all',
                    procurementRowsRead: 0,
                    normalizedContractsUpserted: 0,
                    normalizedActionsUpserted: 0,
                    budgetMappingsUpserted: 0,
                    spendingRowsUpserted: 0,
                    solicitationIdsEvaluated: 0,
                    samRequestsAttempted: 0,
                    samRequestsGranted: 0,
                    samAwardsRequestsAttempted: 0,
                    samAwardsRequestsGranted: 0,
                    samOpportunitiesRequestsAttempted: 0,
                    samOpportunitiesRequestsGranted: 0,
                    samRunRequestCapRequested: 0,
                    samRunRequestCap: 0,
                    samRunRequestsRemaining: 0,
                    samNoticesUpserted: 0,
                    samOpportunitiesTruncatedResponses: 0,
                    samAwardsContractsEvaluated: 0,
                    samAwardsContractsBackfilled: 0,
                    samAwardsActionsBackfilled: 0,
                    samAwardsAmbiguousContracts: 0,
                    samAwardsSolicitationIdsBackfilled: 0,
                    samAwardsTruncatedResponses: 0,
                    samStepTrace: [],
                    samStopReasons: [],
                    samEndpointDecisions: [],
                    samContractAwardsStopReason: null,
                    samOpportunitiesStopReason: null,
                    samGuardrailReason: null,
                    samSinglePassPerEndpoint: false,
                    sourceDocumentsInserted: 0,
                    errors: [],
                    samSessionToken: null
                };
                _12.label = 3;
            case 3:
                _12.trys.push([3, 73, , 80]);
                return [4 /*yield*/, (0, artemisIngest_ts_1.readBooleanSetting)(supabase, SETTING_CONTRACTS_JOB_ENABLED, true)];
            case 4:
                enabled = _12.sent();
                if (!!enabled) return [3 /*break*/, 6];
                stats.samRequestStopReason = 'job_disabled';
                stats.samSkippedReason = 'job_disabled';
                stats.samStepTrace.push({
                    at: new Date().toISOString(),
                    step: 'sam_job_disabled',
                    reason: 'job_disabled'
                });
                return [4 /*yield*/, (0, artemisIngest_ts_1.finishIngestionRun)(supabase, runId, true, {
                        skipped: true,
                        reason: 'job_disabled',
                        samStepTrace: stats.samStepTrace
                    })];
            case 5:
                _12.sent();
                return [2 /*return*/, (0, artemisIngest_ts_1.jsonResponse)({
                        ok: true,
                        runId: runId,
                        skipped: true,
                        reason: 'job_disabled',
                        elapsedMs: Date.now() - startedAt
                    })];
            case 6: return [4 /*yield*/, (0, artemisIngest_ts_1.readBooleanSetting)(supabase, SETTING_SAM_DISABLE_ON_GUARDRAIL, true)];
            case 7:
                disableJobOnGuardrail = _12.sent();
                return [4 /*yield*/, (0, artemisIngest_ts_1.readBooleanSetting)(supabase, SETTING_SAM_STOP_ON_EMPTY_OR_ERROR, true)];
            case 8:
                stopOnEmptyOrError_1 = _12.sent();
                return [4 /*yield*/, (0, artemisIngest_ts_1.readBooleanSetting)(supabase, SETTING_SAM_PROBE_BOTH_ENDPOINTS_FIRST, true)];
            case 9:
                probeBothEndpointsFirst = _12.sent();
                stats.samDisableJobOnGuardrail = disableJobOnGuardrail;
                stats.samStopOnEmptyOrError = stopOnEmptyOrError_1;
                stats.samProbeBothEndpointsFirst = probeBothEndpointsFirst;
                return [4 /*yield*/, req.json().catch(function () { return ({}); })];
            case 10:
                body = (_12.sent());
                bodySamSessionToken_1 = stringOrNull(body.samSessionToken);
                bodyRequestedSamMaxRequestsPerRun = readOptionalInteger(body === null || body === void 0 ? void 0 : body.samMaxRequestsPerRun, { min: 0, max: 9999 });
                bodySamSinglePassPerEndpoint = readBooleanValue(body === null || body === void 0 ? void 0 : body.samSinglePassPerEndpoint);
                _a = readIngestMode;
                return [4 /*yield*/, (0, artemisIngest_ts_1.readStringSetting)(supabase, 'artemis_contracts_ingest_mode', 'incremental')];
            case 11:
                configuredMode = _a.apply(void 0, [_12.sent()]);
                mode = readIngestMode(stringOrNull(body.mode)) || configuredMode;
                stage = readIngestStage(stringOrNull(body.stage)) || 'all';
                _c = (_b = Math).max;
                _d = [0];
                _f = (_e = Math).trunc;
                return [4 /*yield*/, (0, artemisIngest_ts_1.readNumberSetting)(supabase, 'artemis_sam_max_requests_per_run', DEFAULT_SAM_MAX_REQUESTS_PER_RUN)];
            case 12:
                configuredSamMaxRequestsPerRun = _c.apply(_b, _d.concat([_f.apply(_e, [_12.sent()])]));
                samMaxRequestsPerRun = bodyRequestedSamMaxRequestsPerRun === null
                    ? configuredSamMaxRequestsPerRun
                    : Math.min(bodyRequestedSamMaxRequestsPerRun, configuredSamMaxRequestsPerRun);
                stats.mode = mode;
                stats.stage = stage;
                stats.samSessionToken = bodySamSessionToken_1;
                stats.samSinglePassPerEndpoint = bodySamSinglePassPerEndpoint;
                stats.samMaxRequestsPerRunRequested = bodyRequestedSamMaxRequestsPerRun;
                stats.samMaxRequestsPerRunConfigured = configuredSamMaxRequestsPerRun;
                stats.samMaxRequestsPerRunApplied = samMaxRequestsPerRun;
                shouldReadProcurementRows = stage === 'all' || stage === 'normalize';
                shouldMarkNormalizedRunning = shouldReadProcurementRows || stage === 'budget-map';
                if (!shouldMarkNormalizedRunning) return [3 /*break*/, 14];
                nowIso = new Date().toISOString();
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_NORMALIZED, {
                        sourceType: 'procurement',
                        status: 'running',
                        startedAt: nowIso,
                        lastError: null,
                        metadata: { mode: mode, stage: stage }
                    })];
            case 13:
                _12.sent();
                _12.label = 14;
            case 14:
                if (!(shouldReadProcurementRows && mode === 'incremental')) return [3 /*break*/, 16];
                return [4 /*yield*/, readCheckpointCursor(supabase, CHECKPOINT_NORMALIZED)];
            case 15:
                _g = _12.sent();
                return [3 /*break*/, 17];
            case 16:
                _g = null;
                _12.label = 17;
            case 17:
                previousCursor = _g;
                if (!shouldReadProcurementRows) return [3 /*break*/, 20];
                _j = fetchProcurementAwards;
                _k = [supabase];
                _9 = {
                    mode: mode,
                    cursor: previousCursor
                };
                _m = (_l = Math).max;
                _o = [100];
                _q = (_p = Math).trunc;
                return [4 /*yield*/, (0, artemisIngest_ts_1.readNumberSetting)(supabase, 'artemis_contracts_batch_limit', DEFAULT_BATCH_LIMIT)];
            case 18: return [4 /*yield*/, _j.apply(void 0, _k.concat([(_9.limit = _m.apply(_l, _o.concat([_q.apply(_p, [_12.sent()])])),
                        _9)]))];
            case 19:
                _h = _12.sent();
                return [3 /*break*/, 21];
            case 20:
                _h = [];
                _12.label = 21;
            case 21:
                procurementRows = _h;
                stats.procurementRowsRead = procurementRows.length;
                normalized = buildNormalizedContracts(procurementRows);
                if (!(stage === 'opportunities' || stage === 'spending' || stage === 'budget-map' || stage === 'sam-contract-awards')) return [3 /*break*/, 23];
                return [4 /*yield*/, fetchContractRefs(supabase)];
            case 22:
                _r = _12.sent();
                return [3 /*break*/, 25];
            case 23: return [4 /*yield*/, upsertNormalizedContracts(supabase, normalized.contracts, stats)];
            case 24:
                _r = _12.sent();
                _12.label = 25;
            case 25:
                contractRefs = _r;
                contractIdByKey = new Map(contractRefs.map(function (row) { return [row.contract_key, row.id]; }));
                if (!(stage === 'all' || stage === 'normalize')) return [3 /*break*/, 28];
                actions = buildContractActions(procurementRows, contractIdByKey);
                return [4 /*yield*/, upsertContractActions(supabase, actions, stats)];
            case 26:
                actionCount = _12.sent();
                stats.normalizedActionsUpserted = actionCount;
                nextCursor = resolveNextCursor(procurementRows);
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_NORMALIZED, {
                        sourceType: 'procurement',
                        status: 'complete',
                        cursor: nextCursor,
                        recordsIngested: Number(stats.normalizedContractsUpserted || 0) + Number(stats.normalizedActionsUpserted || 0),
                        endedAt: new Date().toISOString(),
                        lastError: null,
                        metadata: {
                            mode: mode,
                            stage: stage,
                            previousCursor: previousCursor,
                            nextCursor: nextCursor,
                            procurementRowsRead: procurementRows.length
                        }
                    })];
            case 27:
                _12.sent();
                _12.label = 28;
            case 28:
                if (!(stage === 'all' || stage === 'budget-map')) return [3 /*break*/, 34];
                _s = artemisIngest_ts_1.updateCheckpoint;
                _t = [supabase, CHECKPOINT_NORMALIZED];
                _10 = {
                    sourceType: 'procurement',
                    status: 'running'
                };
                _u = [{}];
                return [4 /*yield*/, safeCheckpointMetadata(supabase, CHECKPOINT_NORMALIZED)];
            case 29: return [4 /*yield*/, _s.apply(void 0, _t.concat([(_10.metadata = __assign.apply(void 0, [__assign.apply(void 0, _u.concat([(_12.sent())])), { budgetMappingStartedAt: new Date().toISOString() }]),
                        _10)]))];
            case 30:
                _12.sent();
                return [4 /*yield*/, upsertBudgetMappings(supabase, contractRefs, stats)];
            case 31:
                mapped = _12.sent();
                stats.budgetMappingsUpserted = mapped;
                _v = artemisIngest_ts_1.updateCheckpoint;
                _w = [supabase, CHECKPOINT_NORMALIZED];
                _11 = {
                    sourceType: 'procurement',
                    status: 'complete',
                    endedAt: new Date().toISOString(),
                    lastError: null
                };
                _x = [{}];
                return [4 /*yield*/, safeCheckpointMetadata(supabase, CHECKPOINT_NORMALIZED)];
            case 32: return [4 /*yield*/, _v.apply(void 0, _w.concat([(_11.metadata = __assign.apply(void 0, [__assign.apply(void 0, _x.concat([(_12.sent())])), { budgetMappingEndedAt: new Date().toISOString(), budgetMappingsUpserted: mapped }]),
                        _11)]))];
            case 33:
                _12.sent();
                _12.label = 34;
            case 34:
                if (!(stage === 'all' || stage === 'spending')) return [3 /*break*/, 38];
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_SPENDING, {
                        sourceType: 'procurement',
                        status: 'running',
                        startedAt: new Date().toISOString(),
                        lastError: null
                    })];
            case 35:
                _12.sent();
                return [4 /*yield*/, upsertSpendingTimeseries(supabase, contractRefs, stats)];
            case 36:
                spendingRows = _12.sent();
                stats.spendingRowsUpserted = spendingRows;
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_SPENDING, {
                        sourceType: 'procurement',
                        status: 'complete',
                        recordsIngested: spendingRows,
                        endedAt: new Date().toISOString(),
                        lastError: null
                    })];
            case 37:
                _12.sent();
                _12.label = 38;
            case 38:
                runSamContractAwards_1 = stage === 'all' || stage === 'sam-contract-awards';
                runSamOpportunities_1 = stage === 'all' || stage === 'opportunities';
                allowFallbackLookup_1 = stage === 'all';
                shouldProbeBothEndpoints = probeBothEndpointsFirst &&
                    (stage === 'all' || stage === 'sam-contract-awards') &&
                    runSamContractAwards_1 &&
                    runSamOpportunities_1;
                samApiKey_1 = (Deno.env.get('SAM_GOV_API_KEY') || '').trim();
                remainingSamRequests_1 = 0;
                samGuardrailTriggered_1 = false;
                samGuardrailReason_1 = null;
                targetedSolicitationIds_1 = new Set();
                probeStopReasons_1 = [];
                samContractAwardsStopReason_1 = null;
                samOpportunitiesStopReason_1 = null;
                stopReasonIsGuardrail_1 = function (reason, includeNoDataAndNoCandidates) {
                    if (!reason)
                        return false;
                    if (reason === 'sam_no_new_data' || reason === 'sam_no_candidates')
                        return includeNoDataAndNoCandidates;
                    if (reason === 'sam_quota_blocked')
                        return true;
                    if (reason === 'sam_quota_throttled')
                        return true;
                    if (reason === 'sam_http_404_not_found')
                        return true;
                    if (reason === 'sam_run_cap_exhausted')
                        return true;
                    if (reason === 'sam_probe_insufficient_run_cap')
                        return true;
                    if (reason.startsWith('sam_http_error_'))
                        return true;
                    if (reason.startsWith('sam_auth_error_'))
                        return true;
                    return false;
                };
                shouldStopSamRun_1 = function (reason) { return stopReasonIsGuardrail_1(reason, stopOnEmptyOrError_1); };
                samStepTrace_1 = stats.samStepTrace;
                getSamEndpointDecisions_1 = function () {
                    return (Array.isArray(stats.samEndpointDecisions)
                        ? stats.samEndpointDecisions
                        : (stats.samEndpointDecisions = []));
                };
                pushSamStep_1 = function (step, details) {
                    if (details === void 0) { details = {}; }
                    samStepTrace_1.push(__assign({ at: new Date().toISOString(), step: step }, details));
                };
                logSamEndpointDecision_1 = function (endpoint, phase, action, reason, details) {
                    if (reason === void 0) { reason = null; }
                    if (details === void 0) { details = {}; }
                    var decision = __assign({ at: new Date().toISOString(), endpoint: endpoint, phase: phase, action: action, reason: reason }, details);
                    getSamEndpointDecisions_1().push(decision);
                    pushSamStep_1('sam_endpoint_decision', decision);
                };
                stats.samProbeBothEndpointsArmed = shouldProbeBothEndpoints;
                if (!(runSamContractAwards_1 || runSamOpportunities_1)) return [3 /*break*/, 40];
                requestedRunCap = Math.max(0, Math.trunc(samMaxRequestsPerRun));
                return [4 /*yield*/, (0, artemisIngest_ts_1.readDailyQuotaWindow)(supabase, {
                        stateKey: 'artemis_sam_quota_state',
                        limitKey: 'artemis_sam_daily_quota_limit',
                        reserveKey: 'artemis_sam_daily_quota_reserve',
                        defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
                        defaultReserve: DEFAULT_SAM_DAILY_RESERVE
                    })];
            case 39:
                quotaWindow = _12.sent();
                remainingSamRequests_1 = Math.max(0, Math.min(requestedRunCap, quotaWindow.available));
                stats.samRunRequestCapRequested = requestedRunCap;
                stats.samRunRequestCap = remainingSamRequests_1;
                stats.samRunRequestsRemaining = remainingSamRequests_1;
                stats.samQuotaWindow = quotaWindow;
                stats.samQuota = quotaWindow;
                pushSamStep_1('sam_quota_window', {
                    requestedRunCap: requestedRunCap,
                    effectiveRunCap: remainingSamRequests_1,
                    quotaDate: quotaWindow.date,
                    quotaUsed: quotaWindow.used,
                    quotaLimit: quotaWindow.limit,
                    quotaReserve: quotaWindow.reserve,
                    quotaAvailable: quotaWindow.available
                });
                _12.label = 40;
            case 40:
                shouldTreatSamStopReasonAsGuardrail_1 = function (reason) { return stopReasonIsGuardrail_1(reason, stopOnEmptyOrError_1); };
                getSamStopReasons_1 = function () {
                    return (Array.isArray(stats.samStopReasons) ? stats.samStopReasons : (stats.samStopReasons = []));
                };
                getSamProbeStopReasons = function () {
                    return (Array.isArray(stats.samProbeStopReasons)
                        ? stats.samProbeStopReasons
                        : (stats.samProbeStopReasons = []));
                };
                recordSamGuardrail_1 = function (guardrailReason, stopReason, deferGuardrail) {
                    if (!stopReason)
                        return;
                    if (!shouldTreatSamStopReasonAsGuardrail_1(stopReason))
                        return;
                    if (samGuardrailTriggered_1) {
                        var stopReasons_1 = getSamStopReasons_1();
                        if (!stopReasons_1.includes(stopReason))
                            stopReasons_1.push(stopReason);
                        if (deferGuardrail && !probeStopReasons_1.includes(guardrailReason)) {
                            probeStopReasons_1.push(guardrailReason);
                            pushSamStep_1('sam_guardrail_reason', { guardrailReason: guardrailReason, stopReason: stopReason, deferred: deferGuardrail });
                        }
                        return;
                    }
                    var currentStopReason = stringOrNull(stats.samRequestStopReason);
                    if (!currentStopReason)
                        stats.samRequestStopReason = stopReason;
                    if (!stats.samSkippedReason)
                        stats.samSkippedReason = stopReason;
                    var stopReasons = (Array.isArray(stats.samStopReasons)
                        ? stats.samStopReasons
                        : (stats.samStopReasons = []));
                    if (stopReason && !stopReasons.includes(stopReason)) {
                        stopReasons.push(stopReason);
                    }
                    pushSamStep_1('sam_guardrail_reason', { guardrailReason: guardrailReason, stopReason: stopReason, deferred: deferGuardrail });
                    samGuardrailTriggered_1 = true;
                    if (!samGuardrailReason_1)
                        samGuardrailReason_1 = guardrailReason;
                    if (deferGuardrail && !probeStopReasons_1.includes(guardrailReason)) {
                        probeStopReasons_1.push(guardrailReason);
                    }
                };
                if (runSamContractAwards_1 || runSamOpportunities_1) {
                    requestedRunCap = Math.max(0, Math.trunc(samMaxRequestsPerRun));
                    if (requestedRunCap < 1) {
                        recordSamGuardrail_1('sam_run_cap:requested_zero', 'sam_run_cap_exhausted', false);
                    }
                    else if (remainingSamRequests_1 < 1) {
                        recordSamGuardrail_1('sam_run_cap:quota_exhausted', 'sam_run_cap_exhausted', false);
                    }
                }
                mergeLookupSource_1 = function (incoming) {
                    if (!incoming || incoming === 'none')
                        return;
                    var existing = stringOrNull(stats.samLookupSource);
                    if (!existing || existing === 'none') {
                        stats.samLookupSource = incoming;
                        return;
                    }
                    if (existing === incoming)
                        return;
                    stats.samLookupSource = 'mixed';
                };
                applyContractAwardsResult_1 = function (result, options) {
                    for (var _i = 0, _a = result.targetedSolicitationIds; _i < _a.length; _i++) {
                        var solicitationId = _a[_i];
                        targetedSolicitationIds_1.add(solicitationId);
                    }
                    stats.samAwardsContractsEvaluated = Number(stats.samAwardsContractsEvaluated || 0) + result.contractsEvaluated;
                    stats.samAwardsContractsBackfilled = Number(stats.samAwardsContractsBackfilled || 0) + result.contractsBackfilled;
                    stats.samAwardsActionsBackfilled = Number(stats.samAwardsActionsBackfilled || 0) + result.actionsBackfilled;
                    stats.samAwardsRowsUpserted = Number(stats.samAwardsRowsUpserted || 0) + result.awardRowsUpserted;
                    stats.samAwardsAmbiguousContracts = Number(stats.samAwardsAmbiguousContracts || 0) + result.ambiguousContracts;
                    stats.samAwardsSolicitationIdsBackfilled = targetedSolicitationIds_1.size;
                    stats.samAwardsTruncatedResponses = Number(stats.samAwardsTruncatedResponses || 0) + result.truncatedResponses;
                    stats.samRequestsAttempted = Number(stats.samRequestsAttempted || 0) + result.samRequestsAttempted;
                    stats.samRequestsGranted = Number(stats.samRequestsGranted || 0) + result.samRequestsGranted;
                    stats.samAwardsRequestsAttempted = Number(stats.samAwardsRequestsAttempted || 0) + result.samRequestsAttempted;
                    stats.samAwardsRequestsGranted = Number(stats.samAwardsRequestsGranted || 0) + result.samRequestsGranted;
                    stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + result.sourceDocumentsInserted;
                    if (result.samQuota)
                        stats.samQuota = result.samQuota;
                    if (result.samQuotaBlocked)
                        stats.samQuotaBlocked = true;
                    if (result.samRunCapReached)
                        stats.samRunCapReached = true;
                    if (shouldStopSamRun_1(result.stopReason)) {
                        samContractAwardsStopReason_1 = result.stopReason;
                        recordSamGuardrail_1("sam_contract_awards:".concat(result.stopReason), result.stopReason, false);
                    }
                    stats.samContractAwardsStopReason = samContractAwardsStopReason_1;
                    remainingSamRequests_1 = Math.max(0, remainingSamRequests_1 - result.samRequestsGranted);
                    stats.samRunRequestsRemaining = remainingSamRequests_1;
                };
                applyOpportunitiesResult_1 = function (result, options) {
                    stats.solicitationIdsEvaluated = Number(stats.solicitationIdsEvaluated || 0) + result.solicitationIdsEvaluated;
                    stats.samNoticesUpserted = Number(stats.samNoticesUpserted || 0) + result.noticesUpserted;
                    stats.samOpportunitiesTruncatedResponses = Number(stats.samOpportunitiesTruncatedResponses || 0) + result.truncatedResponses;
                    stats.samRequestsAttempted = Number(stats.samRequestsAttempted || 0) + result.samRequestsAttempted;
                    stats.samRequestsGranted = Number(stats.samRequestsGranted || 0) + result.samRequestsGranted;
                    stats.samOpportunitiesRequestsAttempted = Number(stats.samOpportunitiesRequestsAttempted || 0) + result.samRequestsAttempted;
                    stats.samOpportunitiesRequestsGranted = Number(stats.samOpportunitiesRequestsGranted || 0) + result.samRequestsGranted;
                    stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + result.sourceDocumentsInserted;
                    if (result.samQuota)
                        stats.samQuota = result.samQuota;
                    if (result.samQuotaBlocked)
                        stats.samQuotaBlocked = true;
                    if (result.samRunCapReached)
                        stats.samRunCapReached = true;
                    if (shouldStopSamRun_1(result.stopReason)) {
                        samOpportunitiesStopReason_1 = result.stopReason;
                        recordSamGuardrail_1("sam_opportunities:".concat(result.stopReason), result.stopReason, false);
                    }
                    stats.samOpportunitiesStopReason = samOpportunitiesStopReason_1;
                    remainingSamRequests_1 = Math.max(0, remainingSamRequests_1 - result.samRequestsGranted);
                    stats.samRunRequestsRemaining = remainingSamRequests_1;
                    if (result.stopReason) {
                        logSamEndpointDecision_1('opportunities', options.phase, 'endpoint_stop', result.stopReason, {
                            stopReason: result.stopReason,
                            samRequestsGranted: result.samRequestsGranted,
                            samRequestsAttempted: result.samRequestsAttempted,
                            lookupSource: result.lookupSource,
                            forceProbeWhenQueueEmpty: options.forceProbeWhenQueueEmpty
                        });
                    }
                    mergeLookupSource_1(result.lookupSource);
                };
                if (!runSamContractAwards_1) return [3 /*break*/, 42];
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_SAM_CONTRACT_AWARDS, {
                        sourceType: 'procurement',
                        status: 'running',
                        startedAt: new Date().toISOString(),
                        lastError: null
                    })];
            case 41:
                _12.sent();
                pushSamStep_1('sam_checkpoint_running', { checkpoint: CHECKPOINT_SAM_CONTRACT_AWARDS });
                _12.label = 42;
            case 42:
                if (!runSamOpportunities_1) return [3 /*break*/, 44];
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_OPPORTUNITIES, {
                        sourceType: 'procurement',
                        status: 'running',
                        startedAt: new Date().toISOString(),
                        lastError: null
                    })];
            case 43:
                _12.sent();
                pushSamStep_1('sam_checkpoint_running', { checkpoint: CHECKPOINT_OPPORTUNITIES });
                _12.label = 44;
            case 44:
                if (!((runSamContractAwards_1 || runSamOpportunities_1) && !samApiKey_1)) return [3 /*break*/, 45];
                recordSamGuardrail_1('sam_config:missing_sam_api_key', 'missing_sam_api_key', false);
                return [3 /*break*/, 63];
            case 45:
                if (!(runSamContractAwards_1 || runSamOpportunities_1)) return [3 /*break*/, 63];
                if (!runSamContractAwards_1) return [3 /*break*/, 47];
                return [4 /*yield*/, (0, artemisIngest_ts_1.readStringSetting)(supabase, 'artemis_sam_contract_awards_api_url', 'https://api.sam.gov/contract-awards/v1/search')];
            case 46:
                _y = _12.sent();
                return [3 /*break*/, 48];
            case 47:
                _y = null;
                _12.label = 48;
            case 48:
                contractAwardsApiUrl_1 = _y;
                if (!runSamOpportunities_1) return [3 /*break*/, 50];
                return [4 /*yield*/, (0, artemisIngest_ts_1.readStringSetting)(supabase, 'artemis_sam_opportunities_api_url', 'https://api.sam.gov/opportunities/v2/search')];
            case 49:
                _z = _12.sent();
                return [3 /*break*/, 51];
            case 50:
                _z = null;
                _12.label = 51;
            case 51:
                opportunityApiUrl_1 = _z;
                if (!runSamOpportunities_1) return [3 /*break*/, 53];
                _2 = (_1 = Math).max;
                _3 = [30];
                _5 = (_4 = Math).min;
                _6 = [SAM_OPPORTUNITIES_MAX_LOOKBACK_DAYS];
                _8 = (_7 = Math).trunc;
                return [4 /*yield*/, (0, artemisIngest_ts_1.readNumberSetting)(supabase, 'artemis_sam_lookback_days', DEFAULT_LOOKBACK_DAYS)];
            case 52:
                _0 = _2.apply(_1, _3.concat([_5.apply(_4, _6.concat([_8.apply(_7, [_12.sent()])]))]));
                return [3 /*break*/, 54];
            case 53:
                _0 = DEFAULT_LOOKBACK_DAYS;
                _12.label = 54;
            case 54:
                lookbackDays_1 = _0;
                runContractAwardsPass = function (maxRequests, options) { return __awaiter(void 0, void 0, void 0, function () {
                    var result;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                if (samGuardrailTriggered_1) {
                                    logSamEndpointDecision_1('contract-awards', options.phase, 'skip', 'sam_guardrail_triggered', {
                                        remainingSamRequestsBefore: remainingSamRequests_1,
                                        stopReason: stringOrNull(stats.samRequestStopReason)
                                    });
                                    return [2 /*return*/];
                                }
                                if (!runSamContractAwards_1 || !contractAwardsApiUrl_1) {
                                    logSamEndpointDecision_1('contract-awards', options.phase, 'skip', 'endpoint_disabled', {
                                        configured: false,
                                        remainingSamRequestsBefore: remainingSamRequests_1
                                    });
                                    return [2 /*return*/];
                                }
                                if (maxRequests < 1) {
                                    stats.samRunCapReached = true;
                                    recordSamGuardrail_1('sam_contract_awards:run_cap_exhausted', 'sam_run_cap_exhausted', false);
                                    logSamEndpointDecision_1('contract-awards', options.phase, 'skip', 'max_requests_lt_1', {
                                        remainingSamRequestsBefore: remainingSamRequests_1
                                    });
                                    return [2 /*return*/];
                                }
                                logSamEndpointDecision_1('contract-awards', options.phase, 'start', null, {
                                    maxRequests: maxRequests,
                                    remainingSamRequestsBefore: remainingSamRequests_1
                                });
                                return [4 /*yield*/, backfillSolicitationsFromSamContractAwards(supabase, {
                                        apiKey: samApiKey_1,
                                        apiUrl: contractAwardsApiUrl_1,
                                        maxRequests: maxRequests,
                                        sessionToken: bodySamSessionToken_1,
                                        stopOnEmptyOrError: stopOnEmptyOrError_1,
                                        targetScopes: TARGET_SAM_PROGRAM_SCOPES
                                    })];
                            case 1:
                                result = _a.sent();
                                pushSamStep_1('sam_contract_awards_pass_end', {
                                    phase: options.phase,
                                    stopReason: result.stopReason,
                                    samRequestsAttempted: result.samRequestsAttempted,
                                    samRequestsGranted: result.samRequestsGranted,
                                    contractsEvaluated: result.contractsEvaluated,
                                    contractsBackfilled: result.contractsBackfilled,
                                    actionsBackfilled: result.actionsBackfilled,
                                    awardRowsUpserted: result.awardRowsUpserted
                                });
                                logSamEndpointDecision_1('contract-awards', options.phase, 'end', result.stopReason || null, {
                                    phase: options.phase,
                                    stopReason: result.stopReason,
                                    samRequestsAttempted: result.samRequestsAttempted,
                                    samRequestsGranted: result.samRequestsGranted,
                                    contractsEvaluated: result.contractsEvaluated,
                                    contractsBackfilled: result.contractsBackfilled,
                                    actionsBackfilled: result.actionsBackfilled,
                                    awardRowsUpserted: result.awardRowsUpserted
                                });
                                if (result.stopReason) {
                                    logSamEndpointDecision_1('contract-awards', options.phase, 'endpoint_stop', result.stopReason, {
                                        samRequestsGranted: result.samRequestsGranted,
                                        samRequestsAttempted: result.samRequestsAttempted
                                    });
                                }
                                applyContractAwardsResult_1(result, options);
                                return [2 /*return*/];
                        }
                    });
                }); };
                runOpportunitiesPass = function (maxRequests, options) { return __awaiter(void 0, void 0, void 0, function () {
                    var result;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                if (!runSamOpportunities_1 || !opportunityApiUrl_1) {
                                    logSamEndpointDecision_1('opportunities', options.phase, 'skip', 'endpoint_disabled', {
                                        configured: false,
                                        forceProbeWhenQueueEmpty: options.forceProbeWhenQueueEmpty,
                                        remainingSamRequestsBefore: remainingSamRequests_1
                                    });
                                    return [2 /*return*/];
                                }
                                if (samGuardrailTriggered_1) {
                                    logSamEndpointDecision_1('opportunities', options.phase, 'skip', 'sam_guardrail_triggered', {
                                        forceProbeWhenQueueEmpty: options.forceProbeWhenQueueEmpty,
                                        remainingSamRequestsBefore: remainingSamRequests_1,
                                        stopReason: stringOrNull(stats.samRequestStopReason)
                                    });
                                    return [2 /*return*/];
                                }
                                if (maxRequests < 1) {
                                    stats.samRunCapReached = true;
                                    recordSamGuardrail_1('sam_opportunities:run_cap_exhausted', 'sam_run_cap_exhausted', false);
                                    logSamEndpointDecision_1('opportunities', options.phase, 'skip', 'max_requests_lt_1', {
                                        remainingSamRequestsBefore: remainingSamRequests_1
                                    });
                                    return [2 /*return*/];
                                }
                                logSamEndpointDecision_1('opportunities', options.phase, 'start', null, {
                                    maxRequests: maxRequests,
                                    remainingSamRequestsBefore: remainingSamRequests_1,
                                    forceProbeWhenQueueEmpty: options.forceProbeWhenQueueEmpty
                                });
                                return [4 /*yield*/, runSamOpportunitiesSync(supabase, {
                                        apiKey: samApiKey_1,
                                        apiUrl: opportunityApiUrl_1,
                                        lookbackDays: lookbackDays_1,
                                        maxRequests: maxRequests,
                                        prioritizedSolicitationIds: __spreadArray([], targetedSolicitationIds_1, true),
                                        allowFallbackLookup: allowFallbackLookup_1,
                                        forceProbeWhenQueueEmpty: options.forceProbeWhenQueueEmpty,
                                        stopOnEmptyOrError: stopOnEmptyOrError_1,
                                        sessionToken: bodySamSessionToken_1,
                                        targetScopes: TARGET_SAM_PROGRAM_SCOPES
                                    })];
                            case 1:
                                result = _a.sent();
                                pushSamStep_1('sam_opportunities_pass_end', {
                                    phase: options.phase,
                                    stopReason: result.stopReason,
                                    samRequestsAttempted: result.samRequestsAttempted,
                                    samRequestsGranted: result.samRequestsGranted,
                                    solicitationIdsEvaluated: result.solicitationIdsEvaluated,
                                    noticesUpserted: result.noticesUpserted,
                                    lookupSource: result.lookupSource
                                });
                                logSamEndpointDecision_1('opportunities', options.phase, 'end', result.stopReason || null, {
                                    phase: options.phase,
                                    stopReason: result.stopReason,
                                    samRequestsAttempted: result.samRequestsAttempted,
                                    samRequestsGranted: result.samRequestsGranted,
                                    solicitationIdsEvaluated: result.solicitationIdsEvaluated,
                                    noticesUpserted: result.noticesUpserted,
                                    lookupSource: result.lookupSource
                                });
                                if (result.stopReason) {
                                    logSamEndpointDecision_1('opportunities', options.phase, 'endpoint_stop', result.stopReason, {
                                        lookupSource: result.lookupSource,
                                        forceProbeWhenQueueEmpty: options.forceProbeWhenQueueEmpty,
                                        samRequestsGranted: result.samRequestsGranted,
                                        samRequestsAttempted: result.samRequestsAttempted
                                    });
                                }
                                applyOpportunitiesResult_1(result, options);
                                return [2 /*return*/];
                        }
                    });
                }); };
                singlePassPerEndpoint = bodySamSinglePassPerEndpoint;
                probeRequiredEndpoints = (runSamContractAwards_1 ? 1 : 0) + (runSamOpportunities_1 ? 1 : 0);
                requiredProbeRequests = shouldProbeBothEndpoints ? probeRequiredEndpoints : 0;
                if (!(shouldProbeBothEndpoints && remainingSamRequests_1 < requiredProbeRequests)) return [3 /*break*/, 55];
                stats.samRunCapReached = true;
                recordSamGuardrail_1('sam_probe:insufficient_run_cap', 'sam_probe_insufficient_run_cap', false);
                probeStopReasonsList = getSamProbeStopReasons();
                if (!probeStopReasonsList.includes('sam_probe:insufficient_run_cap')) {
                    probeStopReasonsList.push('sam_probe:insufficient_run_cap');
                }
                pushSamStep_1('sam_probe_insufficient_run_cap', {
                    remainingSamRequests: remainingSamRequests_1,
                    requiredRequests: requiredProbeRequests
                });
                return [3 /*break*/, 63];
            case 55:
                if (!runSamContractAwards_1) return [3 /*break*/, 57];
                initialAwardsRequests = shouldProbeBothEndpoints || singlePassPerEndpoint
                    ? Math.min(1, remainingSamRequests_1)
                    : remainingSamRequests_1;
                return [4 /*yield*/, runContractAwardsPass(initialAwardsRequests, {
                        phase: shouldProbeBothEndpoints ? 'probe' : 'single'
                    })];
            case 56:
                _12.sent();
                _12.label = 57;
            case 57:
                if (!(runSamOpportunities_1 && !samGuardrailTriggered_1)) return [3 /*break*/, 59];
                initialOpportunitiesRequests = shouldProbeBothEndpoints || singlePassPerEndpoint
                    ? Math.min(1, remainingSamRequests_1)
                    : remainingSamRequests_1;
                return [4 /*yield*/, runOpportunitiesPass(initialOpportunitiesRequests, {
                        forceProbeWhenQueueEmpty: shouldProbeBothEndpoints || stage === 'opportunities',
                        phase: shouldProbeBothEndpoints ? 'probe' : 'single'
                    })];
            case 58:
                _12.sent();
                _12.label = 59;
            case 59:
                if (shouldProbeBothEndpoints && probeStopReasons_1.length > 0) {
                    samGuardrailTriggered_1 = true;
                    samGuardrailReason_1 = probeStopReasons_1.join('|');
                    stats.samProbeStopReasons = probeStopReasons_1;
                    if (!stats.samSkippedReason)
                        stats.samSkippedReason = 'sam_probe_guardrail_triggered';
                    pushSamStep_1('sam_probe_guardrail_triggered', { probeStopReasons: probeStopReasons_1 });
                }
                if (!(!samGuardrailTriggered_1 && !singlePassPerEndpoint && remainingSamRequests_1 > 0)) return [3 /*break*/, 63];
                if (!runSamContractAwards_1) return [3 /*break*/, 61];
                logSamEndpointDecision_1('contract-awards', 'remaining', 'start', null, {
                    maxRequests: remainingSamRequests_1,
                    remainingSamRequestsBefore: remainingSamRequests_1
                });
                return [4 /*yield*/, runContractAwardsPass(remainingSamRequests_1, { phase: 'remaining' })];
            case 60:
                _12.sent();
                _12.label = 61;
            case 61:
                if (!(runSamOpportunities_1 && !samGuardrailTriggered_1 && remainingSamRequests_1 > 0)) return [3 /*break*/, 63];
                logSamEndpointDecision_1('opportunities', 'remaining', 'start', null, {
                    maxRequests: remainingSamRequests_1,
                    remainingSamRequestsBefore: remainingSamRequests_1,
                    forceProbeWhenQueueEmpty: false
                });
                return [4 /*yield*/, runOpportunitiesPass(remainingSamRequests_1, {
                        forceProbeWhenQueueEmpty: false,
                        phase: 'remaining'
                    })];
            case 62:
                _12.sent();
                _12.label = 63;
            case 63:
                finalSamStopReason_1 = stringOrNull(stats.samRequestStopReason);
                runCapRequestedForInference = Number(stats.samRunRequestCapRequested || 0);
                runCapBudgetForInference = Number(stats.samRunRequestCap || 0);
                runGrantedForInference = Number(stats.samRequestsGranted || 0);
                runRemainingForInference = Number(stats.samRunRequestsRemaining || remainingSamRequests_1 || 0);
                if (!samGuardrailTriggered_1 &&
                    runCapRequestedForInference > 0 &&
                    runCapBudgetForInference === 0 &&
                    runGrantedForInference === 0 &&
                    runRemainingForInference === 0 &&
                    !finalSamStopReason_1) {
                    recordSamGuardrail_1('sam_run_cap:run_cap_budget_exhausted', 'sam_run_cap_exhausted', false);
                    finalSamStopReason_1 = stringOrNull(stats.samRequestStopReason) || 'sam_run_cap_exhausted';
                    if (!stats.samSkippedReason)
                        stats.samSkippedReason = finalSamStopReason_1;
                }
                if (!finalSamStopReason_1 && samGuardrailTriggered_1 && remainingSamRequests_1 < 1) {
                    finalSamStopReason_1 = 'sam_run_cap_exhausted';
                    stats.samRequestStopReason = finalSamStopReason_1;
                }
                finalSamStopReasons = getSamStopReasons_1();
                if (finalSamStopReason_1 && !finalSamStopReasons.includes(finalSamStopReason_1)) {
                    finalSamStopReasons.push(finalSamStopReason_1);
                }
                if (shouldTreatSamStopReasonAsGuardrail_1(finalSamStopReason_1)) {
                    samGuardrailTriggered_1 = true;
                    stats.samSkippedReason = stats.samSkippedReason || finalSamStopReason_1;
                    if (!samGuardrailReason_1)
                        samGuardrailReason_1 = "sam_guardrail:".concat(finalSamStopReason_1);
                }
                if (!samGuardrailReason_1 && stats.samSkippedReason) {
                    samGuardrailReason_1 = "sam_guardrail:".concat(stats.samSkippedReason);
                }
                if (samGuardrailReason_1 && stats.samGuardrailReason !== samGuardrailReason_1) {
                    stats.samGuardrailReason = samGuardrailReason_1;
                }
                if (finalSamStopReason_1) {
                    hasGuardrailTrace = samStepTrace_1.some(function (step) {
                        return step.step === 'sam_guardrail_reason' &&
                            stringOrNull(step.stopReason) === finalSamStopReason_1;
                    });
                    if (!hasGuardrailTrace) {
                        pushSamStep_1('sam_guardrail_reason', {
                            guardrailReason: samGuardrailReason_1 || finalSamStopReason_1,
                            stopReason: finalSamStopReason_1,
                            deferred: false,
                            finalizationPass: true
                        });
                    }
                }
                if (!runSamContractAwards_1) return [3 /*break*/, 65];
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_SAM_CONTRACT_AWARDS, {
                        sourceType: 'procurement',
                        status: 'complete',
                        recordsIngested: Number(stats.samAwardsRowsUpserted || 0),
                        endedAt: new Date().toISOString(),
                        lastError: null,
                        metadata: {
                            contractsEvaluated: stats.samAwardsContractsEvaluated,
                            contractsBackfilled: stats.samAwardsContractsBackfilled,
                            actionsBackfilled: stats.samAwardsActionsBackfilled,
                            awardRowsUpserted: stats.samAwardsRowsUpserted,
                            ambiguousContracts: stats.samAwardsAmbiguousContracts,
                            solicitationIdsBackfilled: stats.samAwardsSolicitationIdsBackfilled,
                            truncatedResponses: stats.samAwardsTruncatedResponses,
                            samRequestsAttempted: stats.samAwardsRequestsAttempted,
                            samRequestsGranted: stats.samAwardsRequestsGranted,
                            samQuota: stats.samQuota || null,
                            stopReason: samContractAwardsStopReason_1 || finalSamStopReason_1,
                            samRequestStopReason: finalSamStopReason_1 || null,
                            samStopReasons: finalSamStopReasons,
                            guardrailReason: samGuardrailReason_1 || null,
                            skippedReason: stats.samSkippedReason || null,
                            probeBothEndpointsFirst: shouldProbeBothEndpoints,
                            probeStopReasons: getSamProbeStopReasons()
                        }
                    })];
            case 64:
                _12.sent();
                _12.label = 65;
            case 65:
                if (!runSamOpportunities_1) return [3 /*break*/, 67];
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_OPPORTUNITIES, {
                        sourceType: 'procurement',
                        status: 'complete',
                        recordsIngested: Number(stats.samNoticesUpserted || 0),
                        endedAt: new Date().toISOString(),
                        lastError: null,
                        metadata: {
                            solicitationIdsEvaluated: stats.solicitationIdsEvaluated,
                            lookupSource: stats.samLookupSource || null,
                            truncatedResponses: stats.samOpportunitiesTruncatedResponses,
                            samRequestsAttempted: stats.samOpportunitiesRequestsAttempted,
                            samRequestsGranted: stats.samOpportunitiesRequestsGranted,
                            samQuota: stats.samQuota || null,
                            stopReason: samOpportunitiesStopReason_1 || finalSamStopReason_1,
                            samRequestStopReason: finalSamStopReason_1 || null,
                            samStopReasons: finalSamStopReasons,
                            guardrailReason: samGuardrailReason_1 || null,
                            skippedReason: stats.samSkippedReason || null,
                            skippedBecause: samGuardrailTriggered_1 ? samGuardrailReason_1 : null,
                            probeBothEndpointsFirst: shouldProbeBothEndpoints,
                            probeStopReasons: getSamProbeStopReasons()
                        }
                    })];
            case 66:
                _12.sent();
                _12.label = 67;
            case 67:
                autoDisableReason = stringOrNull(samGuardrailReason_1) || finalSamStopReason_1 || null;
                if (!(disableJobOnGuardrail && samGuardrailTriggered_1 && autoDisableReason)) return [3 /*break*/, 69];
                pushSamStep_1('sam_guardrail_auto_disable', { reason: autoDisableReason, stopReasons: finalSamStopReasons });
                return [4 /*yield*/, disableArtemisContractsJob(supabase, autoDisableReason, {
                        runId: runId,
                        stage: stage,
                        samRequestsAttempted: Number(stats.samRequestsAttempted || 0),
                        samRequestsGranted: Number(stats.samRequestsGranted || 0),
                        samAwardsRowsUpserted: Number(stats.samAwardsRowsUpserted || 0),
                        samNoticesUpserted: Number(stats.samNoticesUpserted || 0)
                    })];
            case 68:
                _12.sent();
                stats.jobAutoDisabled = true;
                stats.jobAutoDisabledReason = autoDisableReason;
                _12.label = 69;
            case 69: return [4 /*yield*/, (0, artemisIngest_ts_1.insertSourceDocument)(supabase, {
                    sourceKey: CHECKPOINT_NORMALIZED,
                    sourceType: 'procurement',
                    url: 'https://api.sam.gov',
                    title: 'Artemis contract story ingest refresh',
                    summary: "Normalized ".concat(Number(stats.normalizedContractsUpserted || 0), " contracts and ").concat(Number(stats.normalizedActionsUpserted || 0), " actions."),
                    announcedTime: new Date().toISOString(),
                    contentType: 'application/json',
                    raw: { stats: stats }
                })];
            case 70:
                refreshDocId = _12.sent();
                stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;
                return [4 /*yield*/, (0, artemisIngest_ts_1.upsertTimelineEvent)(supabase, {
                        fingerprint: ['contract-story-refresh', new Date().toISOString().slice(0, 10)].join('|'),
                        missionKey: 'program',
                        title: 'Artemis contract story data refreshed',
                        summary: 'Normalized contract, action, solicitation, and spending overlays were refreshed for Artemis procurement monitoring.',
                        eventTime: null,
                        eventTimePrecision: 'unknown',
                        announcedTime: new Date().toISOString(),
                        sourceType: 'procurement',
                        confidence: 'secondary',
                        sourceDocumentId: refreshDocId,
                        sourceUrl: 'https://api.sam.gov',
                        tags: ['procurement', 'contract-story']
                    })];
            case 71:
                _12.sent();
                return [4 /*yield*/, (0, artemisIngest_ts_1.finishIngestionRun)(supabase, runId, true, stats)];
            case 72:
                _12.sent();
                return [2 /*return*/, (0, artemisIngest_ts_1.jsonResponse)({ ok: true, runId: runId, elapsedMs: Date.now() - startedAt, stats: stats })];
            case 73:
                err_1 = _12.sent();
                message = (0, artemisIngest_ts_1.stringifyError)(err_1);
                stats.errors.push({ step: 'fatal', error: message });
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_NORMALIZED, {
                        sourceType: 'procurement',
                        status: 'error',
                        endedAt: new Date().toISOString(),
                        lastError: message
                    }).catch(function () { return undefined; })];
            case 74:
                _12.sent();
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_SAM_CONTRACT_AWARDS, {
                        sourceType: 'procurement',
                        status: 'error',
                        endedAt: new Date().toISOString(),
                        lastError: message
                    }).catch(function () { return undefined; })];
            case 75:
                _12.sent();
                return [4 /*yield*/, (0, artemisIngest_ts_1.updateCheckpoint)(supabase, CHECKPOINT_OPPORTUNITIES, {
                        sourceType: 'procurement',
                        status: 'error',
                        endedAt: new Date().toISOString(),
                        lastError: message
                    }).catch(function () { return undefined; })];
            case 76:
                _12.sent();
                if (!disableJobOnGuardrail) return [3 /*break*/, 78];
                stats.samStepTrace.push({
                    at: new Date().toISOString(),
                    step: 'sam_fatal_auto_disable',
                    reason: "fatal:".concat(message)
                });
                return [4 /*yield*/, disableArtemisContractsJob(supabase, "fatal:".concat(message), {
                        runId: runId,
                        stage: stats.stage || null,
                        samRequestsAttempted: Number(stats.samRequestsAttempted || 0),
                        samRequestsGranted: Number(stats.samRequestsGranted || 0)
                    }).catch(function () { return undefined; })];
            case 77:
                _12.sent();
                stats.jobAutoDisabled = true;
                stats.jobAutoDisabledReason = "fatal:".concat(message);
                _12.label = 78;
            case 78: return [4 /*yield*/, (0, artemisIngest_ts_1.finishIngestionRun)(supabase, runId, false, stats, message)];
            case 79:
                _12.sent();
                return [2 /*return*/, (0, artemisIngest_ts_1.jsonResponse)({ ok: false, runId: runId, error: message, elapsedMs: Date.now() - startedAt, stats: stats }, 500)];
            case 80: return [2 /*return*/];
        }
    });
}); });
function readIngestMode(value) {
    var normalized = normalizeText(value);
    if (normalized === 'bootstrap')
        return 'bootstrap';
    if (normalized === 'incremental')
        return 'incremental';
    return null;
}
function readIngestStage(value) {
    var normalized = normalizeText(value);
    if (normalized === 'all')
        return 'all';
    if (normalized === 'normalize')
        return 'normalize';
    if (normalized === 'sam-contract-awards' || normalized === 'sam_contract_awards' || normalized === 'contract-awards') {
        return 'sam-contract-awards';
    }
    if (normalized === 'opportunities')
        return 'opportunities';
    if (normalized === 'spending')
        return 'spending';
    if (normalized === 'budget-map' || normalized === 'budget_map')
        return 'budget-map';
    return null;
}
function normalizeText(value) {
    if (!value)
        return '';
    return value.trim().toLowerCase();
}
function stringOrNull(value) {
    if (typeof value !== 'string')
        return null;
    var trimmed = value.trim();
    return trimmed.length ? trimmed : null;
}
function numberOrNull(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string')
        return null;
    var trimmed = value.trim();
    if (!trimmed.length)
        return null;
    var parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}
function readOptionalInteger(value, options) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        var parsed = Math.trunc(value);
        if (parsed < options.min || parsed > options.max)
            return null;
        return parsed;
    }
    if (typeof value === 'string') {
        var trimmed = value.trim();
        if (!trimmed.length)
            return null;
        var parsed = Math.trunc(Number(trimmed));
        if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max)
            return null;
        return parsed;
    }
    return null;
}
function readBooleanValue(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value === 1;
    if (typeof value === 'string') {
        var normalized = value.trim().toLowerCase();
        return ['1', 'true', 'on', 'yes', 'enabled'].includes(normalized);
    }
    return false;
}
function dateOnlyOrNull(value) {
    if (typeof value !== 'string')
        return null;
    var trimmed = value.trim();
    if (!trimmed.length)
        return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
        return trimmed;
    var parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed))
        return null;
    return new Date(parsed).toISOString().slice(0, 10);
}
function formatSamDate(value) {
    var month = String(value.getUTCMonth() + 1).padStart(2, '0');
    var day = String(value.getUTCDate()).padStart(2, '0');
    var year = String(value.getUTCFullYear());
    return "".concat(month, "/").concat(day, "/").concat(year);
}
function buildSamOpportunityDateWindow(lookbackDays) {
    var requestedLookbackDays = Math.max(1, Math.min(Math.trunc(lookbackDays), SAM_OPPORTUNITIES_MAX_WINDOW_DAYS));
    var postedTo = new Date();
    var postedToUtc = new Date(Date.UTC(postedTo.getUTCFullYear(), postedTo.getUTCMonth(), postedTo.getUTCDate()));
    var requestedPostedFrom = new Date(postedToUtc.getTime() - requestedLookbackDays * MILLISECONDS_PER_DAY);
    var clampReason = requestedLookbackDays === SAM_OPPORTUNITIES_MAX_WINDOW_DAYS ? 'max_window_cap' : null;
    if (requestedPostedFrom.getUTCMonth() === postedToUtc.getUTCMonth() && requestedPostedFrom.getUTCDate() === postedToUtc.getUTCDate()) {
        requestedPostedFrom = new Date(requestedPostedFrom.getTime() - MILLISECONDS_PER_DAY);
        clampReason = clampReason || 'year_boundary_guard';
    }
    var appliedLookbackDays = Math.max(1, Math.round((postedToUtc.getTime() - requestedPostedFrom.getTime()) / MILLISECONDS_PER_DAY));
    return {
        requestedLookbackDays: requestedLookbackDays,
        appliedLookbackDays: appliedLookbackDays,
        postedFrom: requestedPostedFrom,
        postedToUtc: postedToUtc,
        clampReason: clampReason
    };
}
function missionKeyOrProgram(value) {
    if (typeof value !== 'string')
        return 'program';
    var normalized = value.trim().toLowerCase();
    if (normalized === 'artemis-i')
        return 'artemis-i';
    if (normalized === 'artemis-ii')
        return 'artemis-ii';
    if (normalized === 'artemis-iii')
        return 'artemis-iii';
    if (normalized === 'artemis-iv')
        return 'artemis-iv';
    if (normalized === 'artemis-v')
        return 'artemis-v';
    if (normalized === 'artemis-vi')
        return 'artemis-vi';
    if (normalized === 'artemis-vii')
        return 'artemis-vii';
    return 'program';
}
function contractTypeOrUnknown(value) {
    if (typeof value !== 'string')
        return 'unknown';
    var normalized = value.trim().toLowerCase();
    if (normalized === 'definitive')
        return 'definitive';
    if (normalized === 'idv')
        return 'idv';
    if (normalized === 'order')
        return 'order';
    return 'unknown';
}
function isLikelySamContractLookupCandidate(input) {
    var piid = input.piid.trim().toLowerCase();
    if (!piid.length)
        return false;
    if (piid.startsWith('asst_'))
        return false;
    if (piid.startsWith('grant_'))
        return false;
    var awardType = normalizeText(readMetaString(input.metadata, 'awardType') || readMetaString(input.metadata, 'award_type'));
    if (awardType.includes('grant') || awardType.includes('cooperative'))
        return false;
    if (input.contractType === 'idv' || input.contractType === 'order' || input.contractType === 'definitive') {
        return true;
    }
    // Unknown types are allowed only when PIID resembles a federal contract identifier.
    if (/^cont_(awd|idv)_|^fa\d|^w\d|^n\d|^80[a-z0-9]/i.test(input.piid))
        return true;
    return false;
}
function normalizeSamIdentifier(value) {
    if (!value)
        return null;
    var trimmed = value.trim();
    if (!trimmed.length)
        return null;
    if (trimmed === '-NONE-')
        return null;
    if (trimmed.toLowerCase() === 'none')
        return null;
    return trimmed;
}
function normalizeSamLookupIdentifiers(piid, referencedIdvPiid) {
    var basePiid = normalizeSamIdentifier(piid);
    var lookupRef = normalizeSamIdentifier(referencedIdvPiid);
    if (!basePiid)
        return { piid: null, referencedIdvPiid: lookupRef };
    var upper = basePiid.toUpperCase();
    if (upper.startsWith('ASST_') || upper.startsWith('GRANT_')) {
        return { piid: null, referencedIdvPiid: null };
    }
    var parts = basePiid.split('_');
    var lookupPiid = basePiid;
    if (upper.startsWith('CONT_AWD_')) {
        var extractedPiid = normalizeSamIdentifier(parts[2] || null);
        var extractedRef = normalizeSamIdentifier(parts[4] || null);
        if (extractedPiid)
            lookupPiid = extractedPiid;
        if (extractedRef)
            lookupRef = extractedRef;
        return { piid: lookupPiid, referencedIdvPiid: lookupRef };
    }
    if (upper.startsWith('CONT_IDV_')) {
        var extractedPiid = normalizeSamIdentifier(parts[2] || null);
        if (extractedPiid)
            lookupPiid = extractedPiid;
        return { piid: lookupPiid, referencedIdvPiid: lookupRef };
    }
    if (upper.startsWith('CONT_')) {
        var extractedPiid = normalizeSamIdentifier(parts[2] || null);
        if (extractedPiid)
            lookupPiid = extractedPiid;
    }
    return { piid: lookupPiid, referencedIdvPiid: lookupRef };
}
function normalizeProgramScope(value) {
    if (!value)
        return null;
    var normalized = value.trim().toLowerCase();
    if (!normalized)
        return null;
    if (normalized === 'artemis')
        return 'artemis';
    if (normalized === 'blue-origin' || normalized === 'blue_origin' || normalized === 'blueorigin' || normalized === 'blue') {
        return 'blue-origin';
    }
    if (normalized === 'spacex' || normalized === 'space-x' || normalized === 'space_x' || normalized === 'space x') {
        return 'spacex';
    }
    if (normalized === 'other')
        return 'other';
    return null;
}
function scopePriority(scope) {
    if (scope === 'artemis')
        return 1;
    if (scope === 'blue-origin')
        return 2;
    if (scope === 'spacex')
        return 3;
    return 4;
}
function inferContractProgramScope(input) {
    var directScope = normalizeProgramScope(stringOrNull(input.metadata.programScope) || stringOrNull(input.metadata.program_scope));
    if (directScope)
        return directScope;
    var rawScopes = Array.isArray(input.metadata.programScopes)
        ? input.metadata.programScopes
        : Array.isArray(input.metadata.program_scopes)
            ? input.metadata.program_scopes
            : [];
    if (rawScopes.length > 0) {
        var scoped = rawScopes
            .map(function (value) { return normalizeProgramScope(typeof value === 'string' ? value : null); })
            .filter(function (value) { return Boolean(value); })
            .sort(function (a, b) { return scopePriority(a) - scopePriority(b); });
        if (scoped.length > 0)
            return scoped[0];
    }
    if (input.missionKey !== 'program')
        return 'artemis';
    var text = [
        input.awardeeName,
        input.description,
        input.contractKey,
        stringOrNull(readMetaString(input.metadata, 'recipient')),
        stringOrNull(readMetaString(input.metadata, 'keyword'))
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    if (/\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b/.test(text))
        return 'blue-origin';
    if (/\bspace\s*x\b|\bspacex\b|\bspace exploration technologies\b|\bstarship\b|\bfalcon\b|\bdragon\b|\bstarlink\b/.test(text)) {
        return 'spacex';
    }
    if (/\bartemis\b|\bsls\b|\borion\b|\bhuman\s+landing\s+system\b|\bgateway\b/.test(text))
        return 'artemis';
    return 'other';
}
function safeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    return value;
}
function readCheckpointCursor(supabase, sourceKey) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('artemis_ingest_checkpoints')
                        .select('cursor')
                        .eq('source_key', sourceKey)
                        .maybeSingle()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, typeof (data === null || data === void 0 ? void 0 : data.cursor) === 'string' && data.cursor.length > 0 ? data.cursor : null];
            }
        });
    });
}
function safeCheckpointMetadata(supabase, sourceKey) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('artemis_ingest_checkpoints')
                        .select('metadata')
                        .eq('source_key', sourceKey)
                        .maybeSingle()];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        return [2 /*return*/, {}];
                    return [2 /*return*/, safeRecord(data === null || data === void 0 ? void 0 : data.metadata)];
            }
        });
    });
}
function fetchProcurementAwards(supabase, options) {
    return __awaiter(this, void 0, void 0, function () {
        var query, _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    query = supabase
                        .from('artemis_procurement_awards')
                        .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,metadata,updated_at')
                        .order('updated_at', { ascending: true, nullsFirst: false })
                        .limit(options.limit);
                    if (options.mode === 'incremental' && options.cursor) {
                        query = query.gt('updated_at', options.cursor);
                    }
                    return [4 /*yield*/, query];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, (data || []).filter(function (row) {
                            return Boolean(stringOrNull(row.usaspending_award_id) || stringOrNull(readMetaString(row.metadata, 'piid')));
                        })];
            }
        });
    });
}
function resolveNextCursor(rows) {
    var sorted = rows
        .map(function (row) { return stringOrNull(row.updated_at); })
        .filter(function (value) { return Boolean(value); })
        .sort(function (a, b) { return (a > b ? -1 : a < b ? 1 : 0); });
    return sorted[0] || null;
}
function buildNormalizedContracts(rows) {
    var nowIso = new Date().toISOString();
    var map = new Map();
    for (var _i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
        var row = rows_1[_i];
        var meta = safeRecord(row.metadata);
        var piid = stringOrNull(readMetaString(meta, 'piid')) ||
            stringOrNull(readMetaString(meta, 'awardId')) ||
            stringOrNull(readMetaString(meta, 'generatedAwardId')) ||
            stringOrNull(row.usaspending_award_id);
        if (!piid)
            continue;
        var referencedIdvPiid = stringOrNull(readMetaString(meta, 'referencedIdvPiid')) ||
            stringOrNull(readMetaString(meta, 'referenced_idv_piid')) ||
            stringOrNull(readMetaString(meta, 'parentAwardId')) ||
            null;
        var contractKey = buildContractKey(piid, referencedIdvPiid);
        var contractType = inferContractType(meta, referencedIdvPiid);
        var candidate = {
            contract_key: contractKey,
            piid: piid,
            referenced_idv_piid: referencedIdvPiid,
            parent_award_id: stringOrNull(readMetaString(meta, 'parentAwardId')),
            agency_code: stringOrNull(readMetaString(meta, 'agencyCode')),
            subtier_code: stringOrNull(readMetaString(meta, 'subtierCode')) || '8000',
            mission_key: missionKeyOrProgram(row.mission_key),
            awardee_name: stringOrNull(row.recipient),
            awardee_uei: stringOrNull(readMetaString(meta, 'awardeeUei')),
            contract_type: contractType,
            description: stringOrNull(row.award_title) || stringOrNull(readMetaString(meta, 'description')),
            base_award_date: dateOnlyOrNull(row.awarded_on),
            source_document_id: stringOrNull(row.source_document_id),
            metadata: __assign(__assign({}, meta), { normalizedFrom: 'artemis_procurement_awards', sourceAwardId: row.usaspending_award_id || null }),
            updated_at: nowIso
        };
        var existing = map.get(contractKey);
        if (!existing) {
            map.set(contractKey, candidate);
            continue;
        }
        map.set(contractKey, choosePreferredContract(existing, candidate));
    }
    return { contracts: __spreadArray([], map.values(), true) };
}
function choosePreferredContract(a, b) {
    var aDate = Date.parse(a.base_award_date || '');
    var bDate = Date.parse(b.base_award_date || '');
    var safeA = Number.isFinite(aDate) ? aDate : 0;
    var safeB = Number.isFinite(bDate) ? bDate : 0;
    if (safeA !== safeB)
        return safeB > safeA ? b : a;
    var aScore = contractCompletenessScore(a);
    var bScore = contractCompletenessScore(b);
    return bScore > aScore ? b : a;
}
function contractCompletenessScore(row) {
    var score = 0;
    if (row.awardee_name)
        score += 1;
    if (row.description)
        score += 1;
    if (row.base_award_date)
        score += 1;
    if (row.referenced_idv_piid)
        score += 1;
    if (row.agency_code)
        score += 1;
    if (row.source_document_id)
        score += 1;
    return score;
}
function upsertNormalizedContracts(supabase, contracts, stats) {
    return __awaiter(this, void 0, void 0, function () {
        var refs, _i, _a, chunk, _b, data, error, _c, _d, row;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (contracts.length === 0) {
                        stats.normalizedContractsUpserted = 0;
                        return [2 /*return*/, []];
                    }
                    refs = [];
                    _i = 0, _a = chunkArray(contracts, UPSERT_CHUNK_SIZE);
                    _e.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    chunk = _a[_i];
                    return [4 /*yield*/, supabase
                            .from('artemis_contracts')
                            .upsert(chunk, { onConflict: 'contract_key' })
                            .select('id,contract_key,piid,referenced_idv_piid,description,mission_key')];
                case 2:
                    _b = _e.sent(), data = _b.data, error = _b.error;
                    if (error)
                        throw error;
                    for (_c = 0, _d = (data || []); _c < _d.length; _c++) {
                        row = _d[_c];
                        refs.push({
                            id: String(row.id),
                            contract_key: String(row.contract_key),
                            piid: String(row.piid),
                            referenced_idv_piid: stringOrNull(row.referenced_idv_piid),
                            description: stringOrNull(row.description),
                            mission_key: missionKeyOrProgram(row.mission_key)
                        });
                    }
                    _e.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    stats.normalizedContractsUpserted = refs.length;
                    return [2 /*return*/, refs];
            }
        });
    });
}
function fetchContractRefs(supabase) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('artemis_contracts')
                        .select('id,contract_key,piid,referenced_idv_piid,description,mission_key')
                        .order('updated_at', { ascending: false, nullsFirst: false })
                        .limit(DEFAULT_BATCH_LIMIT)];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, (data || []).map(function (row) { return ({
                            id: String(row.id),
                            contract_key: String(row.contract_key),
                            piid: String(row.piid),
                            referenced_idv_piid: stringOrNull(row.referenced_idv_piid),
                            description: stringOrNull(row.description),
                            mission_key: missionKeyOrProgram(row.mission_key)
                        }); })];
            }
        });
    });
}
function buildContractActions(rows, contractIdByKey) {
    var nowIso = new Date().toISOString();
    var actions = [];
    for (var _i = 0, rows_2 = rows; _i < rows_2.length; _i++) {
        var row = rows_2[_i];
        var meta = safeRecord(row.metadata);
        var piid = stringOrNull(readMetaString(meta, 'piid')) ||
            stringOrNull(readMetaString(meta, 'awardId')) ||
            stringOrNull(readMetaString(meta, 'generatedAwardId')) ||
            stringOrNull(row.usaspending_award_id);
        if (!piid)
            continue;
        var referencedIdvPiid = stringOrNull(readMetaString(meta, 'referencedIdvPiid')) ||
            stringOrNull(readMetaString(meta, 'referenced_idv_piid')) ||
            stringOrNull(readMetaString(meta, 'parentAwardId')) ||
            null;
        var contractKey = buildContractKey(piid, referencedIdvPiid);
        var contractId = contractIdByKey.get(contractKey);
        if (!contractId)
            continue;
        var actionDate = dateOnlyOrNull(readMetaString(meta, 'actionDate')) ||
            dateOnlyOrNull(readMetaString(meta, 'periodOfPerformanceStartDate')) ||
            dateOnlyOrNull(row.awarded_on);
        var modNumber = stringOrNull(readMetaString(meta, 'modNumber')) ||
            stringOrNull(readMetaString(meta, 'modificationNumber')) ||
            stringOrNull(readMetaString(meta, 'modification_number')) ||
            '0';
        var solicitationId = stringOrNull(readMetaString(meta, 'solicitationId')) ||
            stringOrNull(readMetaString(meta, 'solicitation_id')) ||
            stringOrNull(readMetaString(meta, 'solicitationNumber')) ||
            null;
        var amount = numberOrNull(row.obligated_amount);
        var hashInput = [contractKey, modNumber, actionDate || 'na', String(amount || 0), row.source_document_id || 'na'].join('|');
        var sourceRecordHash = deterministicHash(hashInput);
        actions.push({
            contract_id: contractId,
            action_key: [contractKey, modNumber, actionDate || 'na', sourceRecordHash].join('|'),
            mod_number: modNumber,
            action_date: actionDate,
            obligation_delta: amount,
            obligation_cumulative: null,
            solicitation_id: solicitationId,
            sam_notice_id: null,
            source: 'usaspending',
            source_record_hash: sourceRecordHash,
            source_document_id: stringOrNull(row.source_document_id),
            metadata: __assign(__assign({}, meta), { sourceAwardId: row.usaspending_award_id || null }),
            updated_at: nowIso
        });
    }
    return actions;
}
function upsertContractActions(supabase, actions, stats) {
    return __awaiter(this, void 0, void 0, function () {
        var total, _i, _a, chunk, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (actions.length === 0)
                        return [2 /*return*/, 0];
                    total = 0;
                    _i = 0, _a = chunkArray(actions, UPSERT_CHUNK_SIZE);
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    chunk = _a[_i];
                    return [4 /*yield*/, supabase.from('artemis_contract_actions').upsert(chunk, { onConflict: 'action_key' })];
                case 2:
                    error = (_b.sent()).error;
                    if (error)
                        throw error;
                    total += chunk.length;
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    stats.normalizedActionsUpserted = total;
                    return [2 /*return*/, total];
            }
        });
    });
}
function upsertBudgetMappings(supabase, contracts, stats) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, budgetRows, error, budget, mappings, _loop_1, _i, contracts_1, contract, total, _b, _c, chunk, upsertError;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (contracts.length === 0)
                        return [2 /*return*/, 0];
                    return [4 /*yield*/, supabase
                            .from('artemis_budget_lines')
                            .select('id,line_item,program,fiscal_year')
                            .order('fiscal_year', { ascending: false, nullsFirst: false })
                            .limit(1500)];
                case 1:
                    _a = _d.sent(), budgetRows = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    budget = (budgetRows || []);
                    if (!budget.length)
                        return [2 /*return*/, 0];
                    mappings = [];
                    _loop_1 = function (contract) {
                        var description = normalizeText(contract.description || '');
                        if (!description.length)
                            return "continue";
                        for (var _e = 0, KEYWORD_ALIGNMENT_RULES_1 = KEYWORD_ALIGNMENT_RULES; _e < KEYWORD_ALIGNMENT_RULES_1.length; _e++) {
                            var rule = KEYWORD_ALIGNMENT_RULES_1[_e];
                            var contractMatched = rule.contractTokens.some(function (token) { return description.includes(token); });
                            if (!contractMatched)
                                continue;
                            for (var _f = 0, budget_1 = budget; _f < budget_1.length; _f++) {
                                var line = budget_1[_f];
                                var lineText = normalizeText("".concat(line.line_item || '', " ").concat(line.program || ''));
                                if (!lineText.includes(rule.lineToken))
                                    continue;
                                mappings.push({
                                    contract_id: contract.id,
                                    budget_line_id: line.id,
                                    match_method: 'rule',
                                    confidence: rule.confidence,
                                    metadata: {
                                        ruleLineToken: rule.lineToken,
                                        contractTokenMatch: rule.contractTokens,
                                        fiscalYear: line.fiscal_year || null
                                    },
                                    updated_at: new Date().toISOString()
                                });
                            }
                        }
                    };
                    for (_i = 0, contracts_1 = contracts; _i < contracts_1.length; _i++) {
                        contract = contracts_1[_i];
                        _loop_1(contract);
                    }
                    if (!mappings.length)
                        return [2 /*return*/, 0];
                    total = 0;
                    _b = 0, _c = chunkArray(dedupeBudgetMappings(mappings), UPSERT_CHUNK_SIZE);
                    _d.label = 2;
                case 2:
                    if (!(_b < _c.length)) return [3 /*break*/, 5];
                    chunk = _c[_b];
                    return [4 /*yield*/, supabase
                            .from('artemis_contract_budget_map')
                            .upsert(chunk, { onConflict: 'contract_id,budget_line_id,match_method' })];
                case 3:
                    upsertError = (_d.sent()).error;
                    if (upsertError)
                        throw upsertError;
                    total += chunk.length;
                    _d.label = 4;
                case 4:
                    _b++;
                    return [3 /*break*/, 2];
                case 5:
                    stats.budgetMappingsUpserted = total;
                    return [2 /*return*/, total];
            }
        });
    });
}
function dedupeBudgetMappings(rows) {
    var seen = new Map();
    for (var _i = 0, rows_3 = rows; _i < rows_3.length; _i++) {
        var row = rows_3[_i];
        var key = [row.contract_id, row.budget_line_id, row.match_method].join('|');
        if (!seen.has(key)) {
            seen.set(key, row);
            continue;
        }
        var existing = seen.get(key);
        var existingConfidence = numberOrNull(existing.confidence) || 0;
        var nextConfidence = numberOrNull(row.confidence) || 0;
        if (nextConfidence > existingConfidence) {
            seen.set(key, row);
        }
    }
    return __spreadArray([], seen.values(), true);
}
function upsertSpendingTimeseries(supabase, contracts, stats) {
    return __awaiter(this, void 0, void 0, function () {
        var contractIdByKey, contractKeyById, contractIds, actionRows, _i, _a, chunk, _b, data, error, totals, _c, actionRows_1, row, contractId, actionDate, delta, fiscal, key, existing, rows, total, _d, _e, chunk, upsertError;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    if (!contracts.length)
                        return [2 /*return*/, 0];
                    contractIdByKey = new Map(contracts.map(function (contract) { return [contract.contract_key, contract.id]; }));
                    contractKeyById = new Map(contracts.map(function (contract) { return [contract.id, contract.contract_key]; }));
                    contractIds = __spreadArray([], new Set(__spreadArray([], contractIdByKey.values(), true).slice(0, SPENDING_ACTION_CONTRACT_ID_LIMIT)), true);
                    actionRows = [];
                    _i = 0, _a = chunkArray(contractIds, SPENDING_ACTION_CONTRACT_ID_CHUNK_SIZE);
                    _f.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    chunk = _a[_i];
                    return [4 /*yield*/, supabase
                            .from('artemis_contract_actions')
                            .select('contract_id,action_date,obligation_delta')
                            .in('contract_id', chunk)];
                case 2:
                    _b = _f.sent(), data = _b.data, error = _b.error;
                    if (error)
                        throw error;
                    actionRows.push.apply(actionRows, (data || []));
                    _f.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    totals = new Map();
                    for (_c = 0, actionRows_1 = actionRows; _c < actionRows_1.length; _c++) {
                        row = actionRows_1[_c];
                        contractId = stringOrNull(row.contract_id);
                        actionDate = dateOnlyOrNull(row.action_date);
                        delta = numberOrNull(row.obligation_delta) || 0;
                        if (!contractId || !actionDate)
                            continue;
                        fiscal = resolveFiscalBucket(actionDate);
                        key = [contractId, fiscal.fiscalYear, fiscal.fiscalMonth].join('|');
                        existing = totals.get(key) || { contractId: contractId, fiscalYear: fiscal.fiscalYear, fiscalMonth: fiscal.fiscalMonth, obligations: 0 };
                        existing.obligations += delta;
                        totals.set(key, existing);
                    }
                    rows = __spreadArray([], totals.values(), true).map(function (entry) { return ({
                        contract_id: entry.contractId,
                        fiscal_year: entry.fiscalYear,
                        fiscal_month: entry.fiscalMonth,
                        obligations: entry.obligations,
                        outlays: null,
                        source: 'usaspending',
                        metadata: {
                            method: 'derived_from_contract_actions',
                            contractKey: contractKeyById.get(entry.contractId) || null
                        },
                        updated_at: new Date().toISOString()
                    }); });
                    if (!rows.length)
                        return [2 /*return*/, 0];
                    total = 0;
                    _d = 0, _e = chunkArray(rows, UPSERT_CHUNK_SIZE);
                    _f.label = 5;
                case 5:
                    if (!(_d < _e.length)) return [3 /*break*/, 8];
                    chunk = _e[_d];
                    return [4 /*yield*/, supabase
                            .from('artemis_spending_timeseries')
                            .upsert(chunk, { onConflict: 'contract_id,fiscal_year,fiscal_month,source' })];
                case 6:
                    upsertError = (_f.sent()).error;
                    if (upsertError)
                        throw upsertError;
                    total += chunk.length;
                    _f.label = 7;
                case 7:
                    _d++;
                    return [3 /*break*/, 5];
                case 8:
                    stats.spendingRowsUpserted = total;
                    return [2 /*return*/, total];
            }
        });
    });
}
function resolveFiscalBucket(dateOnly) {
    var date = new Date("".concat(dateOnly, "T00:00:00.000Z"));
    var year = date.getUTCFullYear();
    var month = date.getUTCMonth() + 1;
    if (month >= 10) {
        return { fiscalYear: year + 1, fiscalMonth: month - 9 };
    }
    return { fiscalYear: year, fiscalMonth: month + 3 };
}
function fetchSolicitationIdsForLookup(supabase_1, limit_1) {
    return __awaiter(this, arguments, void 0, function (supabase, limit, targetScopes) {
        var targetSet, _a, actionRows, error, actionContractIds, _b, contractRows, contractError, contractsById, allowedContractIds, _i, actionContractIds_1, contractId, contract, inferredScope, _c, solicitationRows, solicitationError, seen, ids, _d, _e, row, solicitationId;
        if (targetScopes === void 0) { targetScopes = TARGET_SAM_PROGRAM_SCOPES; }
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    if (limit < 1)
                        return [2 /*return*/, []];
                    targetSet = new Set(targetScopes);
                    if (targetSet.size < 1)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, supabase
                            .from('artemis_contract_actions')
                            .select('contract_id,updated_at')
                            .is('solicitation_id', null)
                            .order('updated_at', { ascending: false, nullsFirst: false })
                            .limit(Math.max(1, limit * 3))];
                case 1:
                    _a = _f.sent(), actionRows = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    actionContractIds = Array.from(new Set((actionRows || [])
                        .map(function (row) { return stringOrNull(row.contract_id); })
                        .filter(Boolean)));
                    if (!actionContractIds.length)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, supabase
                            .from('artemis_contracts')
                            .select('id,contract_key,mission_key,description,awardee_name,metadata')
                            .in('id', actionContractIds)];
                case 2:
                    _b = _f.sent(), contractRows = _b.data, contractError = _b.error;
                    if (contractError)
                        throw contractError;
                    contractsById = new Map((contractRows || []).map(function (row) { return [String(row.id), row]; }));
                    allowedContractIds = [];
                    for (_i = 0, actionContractIds_1 = actionContractIds; _i < actionContractIds_1.length; _i++) {
                        contractId = actionContractIds_1[_i];
                        contract = contractsById.get(contractId);
                        if (!contract)
                            continue;
                        inferredScope = inferContractProgramScope({
                            missionKey: missionKeyOrProgram(contract.mission_key),
                            awardeeName: stringOrNull(contract.awardee_name),
                            description: stringOrNull(contract.description),
                            metadata: safeRecord(contract.metadata),
                            contractKey: stringOrNull(contract.contract_key)
                        });
                        if (!targetSet.has(inferredScope))
                            continue;
                        allowedContractIds.push(contractId);
                    }
                    if (!allowedContractIds.length)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, supabase
                            .from('artemis_contract_actions')
                            .select('solicitation_id,updated_at')
                            .in('contract_id', allowedContractIds)
                            .not('solicitation_id', 'is', null)
                            .order('updated_at', { ascending: false, nullsFirst: false })
                            .limit(Math.max(1, limit * 3))];
                case 3:
                    _c = _f.sent(), solicitationRows = _c.data, solicitationError = _c.error;
                    if (solicitationError)
                        throw solicitationError;
                    seen = new Set();
                    ids = [];
                    for (_d = 0, _e = (solicitationRows || []); _d < _e.length; _d++) {
                        row = _e[_d];
                        solicitationId = stringOrNull(row.solicitation_id);
                        if (!solicitationId)
                            continue;
                        if (seen.has(solicitationId))
                            continue;
                        seen.add(solicitationId);
                        ids.push(solicitationId);
                        if (ids.length >= limit)
                            break;
                    }
                    return [2 /*return*/, ids];
            }
        });
    });
}
function runSamOpportunitiesSync(supabase, input) {
    return __awaiter(this, void 0, void 0, function () {
        var result, queue, requestQueue, dateWindow, _loop_2, _i, requestQueue_1, solicitationId, state_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    result = {
                        solicitationIdsEvaluated: 0,
                        samRequestsAttempted: 0,
                        samRequestsGranted: 0,
                        noticesUpserted: 0,
                        sourceDocumentsInserted: 0,
                        truncatedResponses: 0,
                        samQuota: null,
                        samQuotaBlocked: false,
                        samRunCapReached: false,
                        stopReason: null,
                        lookupSource: 'none'
                    };
                    if (input.maxRequests < 1) {
                        result.samRunCapReached = true;
                        return [2 /*return*/, result];
                    }
                    return [4 /*yield*/, buildOpportunitySolicitationQueue(supabase, {
                            prioritizedSolicitationIds: input.prioritizedSolicitationIds,
                            maxCandidates: input.maxRequests,
                            allowFallbackLookup: input.allowFallbackLookup,
                            targetScopes: input.targetScopes || TARGET_SAM_PROGRAM_SCOPES
                        })];
                case 1:
                    queue = _b.sent();
                    result.solicitationIdsEvaluated = queue.ids.length;
                    if (input.forceProbeWhenQueueEmpty && input.maxRequests > 0 && result.solicitationIdsEvaluated === 0) {
                        result.lookupSource = 'probe';
                    }
                    else if (result.solicitationIdsEvaluated === 0) {
                        if (input.stopOnEmptyOrError) {
                            result.stopReason = 'sam_no_candidates';
                        }
                        return [2 /*return*/, result];
                    }
                    if (queue.usedTargeted && queue.usedFallback) {
                        result.lookupSource = 'mixed';
                    }
                    else if (queue.usedTargeted) {
                        result.lookupSource = 'targeted';
                    }
                    else if (queue.usedFallback) {
                        result.lookupSource = 'catalog';
                    }
                    requestQueue = __spreadArray([], queue.ids, true);
                    if (!requestQueue.length && input.forceProbeWhenQueueEmpty && input.maxRequests > 0) {
                        requestQueue.push(null);
                        result.lookupSource = 'probe';
                    }
                    dateWindow = buildSamOpportunityDateWindow(input.lookbackDays);
                    _loop_2 = function (solicitationId) {
                        var quota, response, sourceDocId, stopReason, noticesWithDoc;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    if (result.samRequestsGranted >= input.maxRequests) {
                                        result.samRunCapReached = true;
                                        return [2 /*return*/, "break"];
                                    }
                                    result.samRequestsAttempted += 1;
                                    return [4 /*yield*/, (0, artemisIngest_ts_1.claimDailyQuota)(supabase, {
                                            stateKey: 'artemis_sam_quota_state',
                                            limitKey: 'artemis_sam_daily_quota_limit',
                                            reserveKey: 'artemis_sam_daily_quota_reserve',
                                            requested: 1,
                                            defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
                                            defaultReserve: DEFAULT_SAM_DAILY_RESERVE
                                        })];
                                case 1:
                                    quota = _c.sent();
                                    result.samQuota = quota;
                                    if (quota.granted < 1) {
                                        result.samQuotaBlocked = true;
                                        result.stopReason = 'sam_quota_blocked';
                                        return [2 /*return*/, "break"];
                                    }
                                    result.samRequestsGranted += 1;
                                    return [4 /*yield*/, fetchSamOpportunities({
                                            solicitationId: solicitationId,
                                            apiKey: input.apiKey,
                                            apiUrl: input.apiUrl,
                                            lookbackDays: input.lookbackDays,
                                            sessionToken: input.sessionToken,
                                            dateWindow: dateWindow
                                        })];
                                case 2:
                                    response = _c.sent();
                                    if (response.paging.truncated) {
                                        result.truncatedResponses += 1;
                                    }
                                    return [4 /*yield*/, (0, artemisIngest_ts_1.insertSourceDocument)(supabase, {
                                            sourceKey: CHECKPOINT_OPPORTUNITIES,
                                            sourceType: 'procurement',
                                            url: response.url,
                                            title: solicitationId ? "SAM opportunities lookup (".concat(solicitationId, ")") : 'SAM opportunities lookup (probe)',
                                            summary: solicitationId
                                                ? "SAM response status ".concat(response.status, "; extracted ").concat(response.notices.length, " notices for solicitation ").concat(solicitationId, ".")
                                                : "SAM response status ".concat(response.status, "; extracted ").concat(response.notices.length, " notices from probe query."),
                                            announcedTime: new Date().toISOString(),
                                            httpStatus: response.status,
                                            contentType: 'application/json',
                                            raw: {
                                                samSessionToken: input.sessionToken || null,
                                                solicitationId: solicitationId,
                                                probeRequest: solicitationId === null,
                                                dateWindow: response.dateWindow,
                                                ok: response.ok,
                                                noticeCount: response.notices.length,
                                                paging: response.paging,
                                                body: response.body
                                            },
                                            error: response.ok ? null : "http_".concat(response.status)
                                        })];
                                case 3:
                                    sourceDocId = _c.sent();
                                    result.sourceDocumentsInserted += 1;
                                    stopReason = classifySamStopReason(response.status, response.body);
                                    if (stopReason) {
                                        result.stopReason = stopReason;
                                        return [2 /*return*/, "break"];
                                    }
                                    if (!response.ok) {
                                        result.stopReason = "sam_http_error_".concat(response.status);
                                        return [2 /*return*/, "break"];
                                    }
                                    if (response.notices.length === 0 && input.stopOnEmptyOrError) {
                                        result.stopReason = 'sam_no_new_data';
                                        return [2 /*return*/, "break"];
                                    }
                                    noticesWithDoc = response.notices.map(function (notice) { return (__assign(__assign({}, notice), { source_document_id: sourceDocId, updated_at: new Date().toISOString() })); });
                                    if (!(noticesWithDoc.length > 0)) return [3 /*break*/, 6];
                                    return [4 /*yield*/, upsertOpportunityNotices(supabase, noticesWithDoc)];
                                case 4:
                                    _c.sent();
                                    result.noticesUpserted += noticesWithDoc.length;
                                    if (!solicitationId) return [3 /*break*/, 6];
                                    return [4 /*yield*/, attachNoticeToActions(supabase, solicitationId, ((_a = noticesWithDoc[0]) === null || _a === void 0 ? void 0 : _a.notice_id) || null)];
                                case 5:
                                    _c.sent();
                                    _c.label = 6;
                                case 6: return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, requestQueue_1 = requestQueue;
                    _b.label = 2;
                case 2:
                    if (!(_i < requestQueue_1.length)) return [3 /*break*/, 5];
                    solicitationId = requestQueue_1[_i];
                    return [5 /*yield**/, _loop_2(solicitationId)];
                case 3:
                    state_1 = _b.sent();
                    if (state_1 === "break")
                        return [3 /*break*/, 5];
                    _b.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, result];
            }
        });
    });
}
function buildOpportunitySolicitationQueue(supabase, options) {
    return __awaiter(this, void 0, void 0, function () {
        var maxCandidates, seen, ids, usedTargeted, usedFallback, _i, _a, value, solicitationId, fallbackLimit, fallbackIds, _b, fallbackIds_1, solicitationId;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    maxCandidates = Math.max(0, Math.trunc(options.maxCandidates));
                    if (maxCandidates < 1) {
                        return [2 /*return*/, { ids: [], usedTargeted: false, usedFallback: false }];
                    }
                    seen = new Set();
                    ids = [];
                    usedTargeted = false;
                    usedFallback = false;
                    for (_i = 0, _a = options.prioritizedSolicitationIds; _i < _a.length; _i++) {
                        value = _a[_i];
                        solicitationId = stringOrNull(value);
                        if (!solicitationId)
                            continue;
                        if (seen.has(solicitationId))
                            continue;
                        seen.add(solicitationId);
                        ids.push(solicitationId);
                        usedTargeted = true;
                        if (ids.length >= maxCandidates) {
                            return [2 /*return*/, { ids: ids, usedTargeted: usedTargeted, usedFallback: usedFallback }];
                        }
                    }
                    if (!(options.allowFallbackLookup && ids.length < maxCandidates)) return [3 /*break*/, 2];
                    fallbackLimit = Math.max(1, maxCandidates * 3);
                    return [4 /*yield*/, fetchSolicitationIdsForLookup(supabase, fallbackLimit, options.targetScopes || TARGET_SAM_PROGRAM_SCOPES)];
                case 1:
                    fallbackIds = _c.sent();
                    for (_b = 0, fallbackIds_1 = fallbackIds; _b < fallbackIds_1.length; _b++) {
                        solicitationId = fallbackIds_1[_b];
                        if (seen.has(solicitationId))
                            continue;
                        seen.add(solicitationId);
                        ids.push(solicitationId);
                        usedFallback = true;
                        if (ids.length >= maxCandidates)
                            break;
                    }
                    _c.label = 2;
                case 2: return [2 /*return*/, { ids: ids, usedTargeted: usedTargeted, usedFallback: usedFallback }];
            }
        });
    });
}
function backfillSolicitationsFromSamContractAwards(supabase, input) {
    return __awaiter(this, void 0, void 0, function () {
        var result, candidates, targetedIds, _i, candidates_1, candidate, quota, response, sourceDocId, _a, _b, stopReason, resolution, updatedActions;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    result = {
                        contractsEvaluated: 0,
                        contractsBackfilled: 0,
                        actionsBackfilled: 0,
                        awardRowsUpserted: 0,
                        ambiguousContracts: 0,
                        targetedSolicitationIds: [],
                        samRequestsAttempted: 0,
                        samRequestsGranted: 0,
                        sourceDocumentsInserted: 0,
                        truncatedResponses: 0,
                        samQuota: null,
                        samQuotaBlocked: false,
                        samRunCapReached: false,
                        stopReason: null
                    };
                    if (input.maxRequests < 1) {
                        result.samRunCapReached = true;
                        return [2 /*return*/, result];
                    }
                    return [4 /*yield*/, fetchContractAwardsLookupCandidates(supabase, Math.max(1, input.maxRequests * SAM_CONTRACT_AWARDS_CANDIDATE_MULTIPLIER), input.targetScopes)];
                case 1:
                    candidates = _c.sent();
                    result.contractsEvaluated = candidates.length;
                    if (candidates.length < 1) {
                        if (input.stopOnEmptyOrError) {
                            result.stopReason = 'sam_no_candidates';
                        }
                        return [2 /*return*/, result];
                    }
                    targetedIds = new Set();
                    _i = 0, candidates_1 = candidates;
                    _c.label = 2;
                case 2:
                    if (!(_i < candidates_1.length)) return [3 /*break*/, 9];
                    candidate = candidates_1[_i];
                    if (result.samRequestsGranted >= input.maxRequests) {
                        result.samRunCapReached = true;
                        return [3 /*break*/, 9];
                    }
                    result.samRequestsAttempted += 1;
                    return [4 /*yield*/, (0, artemisIngest_ts_1.claimDailyQuota)(supabase, {
                            stateKey: 'artemis_sam_quota_state',
                            limitKey: 'artemis_sam_daily_quota_limit',
                            reserveKey: 'artemis_sam_daily_quota_reserve',
                            requested: 1,
                            defaultLimit: DEFAULT_SAM_DAILY_LIMIT,
                            defaultReserve: DEFAULT_SAM_DAILY_RESERVE
                        })];
                case 3:
                    quota = _c.sent();
                    result.samQuota = quota;
                    if (quota.granted < 1) {
                        result.samQuotaBlocked = true;
                        result.stopReason = 'sam_quota_blocked';
                        return [3 /*break*/, 9];
                    }
                    result.samRequestsGranted += 1;
                    return [4 /*yield*/, fetchSamContractAwards({
                            candidate: candidate,
                            apiKey: input.apiKey,
                            apiUrl: input.apiUrl,
                            sessionToken: input.sessionToken
                        })];
                case 4:
                    response = _c.sent();
                    if (response.paging.truncated) {
                        result.truncatedResponses += 1;
                    }
                    return [4 /*yield*/, (0, artemisIngest_ts_1.insertSourceDocument)(supabase, {
                            sourceKey: CHECKPOINT_SAM_CONTRACT_AWARDS,
                            sourceType: 'procurement',
                            url: response.url,
                            title: "SAM contract awards lookup (".concat(candidate.contractKey, ")"),
                            summary: "SAM contract awards status ".concat(response.status, "; extracted ").concat(response.awards.length, " rows for PIID ").concat(candidate.piid, "."),
                            announcedTime: new Date().toISOString(),
                            httpStatus: response.status,
                            contentType: 'application/json',
                            raw: {
                                samSessionToken: input.sessionToken || null,
                                contractId: candidate.contractId,
                                contractKey: candidate.contractKey,
                                programScope: candidate.programScope,
                                missionKey: candidate.missionKey,
                                piid: candidate.piid,
                                referencedIdvPiid: candidate.referencedIdvPiid,
                                ok: response.ok,
                                method: response.method,
                                rowCount: response.awards.length,
                                paging: response.paging,
                                body: response.body
                            },
                            error: response.ok ? null : "http_".concat(response.status)
                        })];
                case 5:
                    sourceDocId = _c.sent();
                    result.sourceDocumentsInserted += 1;
                    _a = result;
                    _b = _a.awardRowsUpserted;
                    return [4 /*yield*/, upsertSamContractAwardRows(supabase, {
                            candidate: candidate,
                            response: response,
                            sourceDocumentId: sourceDocId
                        })];
                case 6:
                    _a.awardRowsUpserted = _b + _c.sent();
                    stopReason = classifySamStopReason(response.status, response.body);
                    if (stopReason) {
                        result.stopReason = stopReason;
                        return [3 /*break*/, 9];
                    }
                    if (!response.ok) {
                        result.stopReason = "sam_http_error_".concat(response.status);
                        return [3 /*break*/, 9];
                    }
                    if (response.awards.length === 0 && input.stopOnEmptyOrError) {
                        result.stopReason = 'sam_no_new_data';
                        return [3 /*break*/, 9];
                    }
                    resolution = resolveSolicitationIdFromContractAwards(response.awards, candidate);
                    if (resolution.ambiguous) {
                        result.ambiguousContracts += 1;
                        return [3 /*break*/, 8];
                    }
                    if (!resolution.solicitationId)
                        return [3 /*break*/, 8];
                    return [4 /*yield*/, backfillSolicitationIdForContractActions(supabase, candidate.contractId, resolution.solicitationId)];
                case 7:
                    updatedActions = _c.sent();
                    if (updatedActions < 1)
                        return [3 /*break*/, 8];
                    result.contractsBackfilled += 1;
                    result.actionsBackfilled += updatedActions;
                    targetedIds.add(resolution.solicitationId);
                    _c.label = 8;
                case 8:
                    _i++;
                    return [3 /*break*/, 2];
                case 9:
                    result.targetedSolicitationIds = __spreadArray([], targetedIds, true);
                    return [2 /*return*/, result];
            }
        });
    });
}
function fetchContractAwardsLookupCandidates(supabase_1, limit_1) {
    return __awaiter(this, arguments, void 0, function (supabase, limit, targetScopes) {
        var _a, actionRows, actionsError, orderedContractIds, missingCountByContract, _i, _b, row, contractId, contractIds, _c, contractRows, contractsError, contractsById, candidates, _d, contractIds_1, contractId, row, piid, contractKey, lookupIds, contractType, metadata, missionKey, awardeeName, description, programScope;
        if (targetScopes === void 0) { targetScopes = TARGET_SAM_PROGRAM_SCOPES; }
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (limit < 1)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, supabase
                            .from('artemis_contract_actions')
                            .select('contract_id,updated_at')
                            .is('solicitation_id', null)
                            .order('updated_at', { ascending: false, nullsFirst: false })
                            .limit(limit)];
                case 1:
                    _a = _e.sent(), actionRows = _a.data, actionsError = _a.error;
                    if (actionsError)
                        throw actionsError;
                    orderedContractIds = [];
                    missingCountByContract = new Map();
                    for (_i = 0, _b = (actionRows || []); _i < _b.length; _i++) {
                        row = _b[_i];
                        contractId = stringOrNull(row.contract_id);
                        if (!contractId)
                            continue;
                        if (!missingCountByContract.has(contractId)) {
                            orderedContractIds.push(contractId);
                            missingCountByContract.set(contractId, 0);
                        }
                        missingCountByContract.set(contractId, Number(missingCountByContract.get(contractId) || 0) + 1);
                    }
                    if (!orderedContractIds.length)
                        return [2 /*return*/, []];
                    contractIds = orderedContractIds.slice(0, limit);
                    return [4 /*yield*/, supabase
                            .from('artemis_contracts')
                            .select('id,contract_key,piid,referenced_idv_piid,mission_key,awardee_name,description,contract_type,metadata')
                            .in('id', contractIds)];
                case 2:
                    _c = _e.sent(), contractRows = _c.data, contractsError = _c.error;
                    if (contractsError)
                        throw contractsError;
                    contractsById = new Map((contractRows || []).map(function (row) { return [String(row.id), row]; }));
                    candidates = [];
                    for (_d = 0, contractIds_1 = contractIds; _d < contractIds_1.length; _d++) {
                        contractId = contractIds_1[_d];
                        row = contractsById.get(contractId);
                        if (!row)
                            continue;
                        piid = stringOrNull(row.piid);
                        contractKey = stringOrNull(row.contract_key);
                        if (!piid || !contractKey)
                            continue;
                        lookupIds = normalizeSamLookupIdentifiers(piid, stringOrNull(row.referenced_idv_piid));
                        if (!lookupIds.piid)
                            continue;
                        contractType = contractTypeOrUnknown(row.contract_type);
                        metadata = safeRecord(row.metadata);
                        if (!isLikelySamContractLookupCandidate({ piid: lookupIds.piid, contractType: contractType, metadata: metadata })) {
                            continue;
                        }
                        missionKey = missionKeyOrProgram(row.mission_key);
                        awardeeName = stringOrNull(row.awardee_name);
                        description = stringOrNull(row.description);
                        programScope = inferContractProgramScope({
                            missionKey: missionKey,
                            awardeeName: awardeeName,
                            description: description,
                            metadata: metadata,
                            contractKey: contractKey
                        });
                        if (!targetScopes.includes(programScope))
                            continue;
                        candidates.push({
                            contractId: contractId,
                            contractKey: contractKey,
                            piid: lookupIds.piid,
                            referencedIdvPiid: lookupIds.referencedIdvPiid,
                            missionKey: missionKey,
                            awardeeName: awardeeName,
                            description: description,
                            programScope: programScope,
                            scopePriority: scopePriority(programScope),
                            missingActionCount: Number(missingCountByContract.get(contractId) || 0)
                        });
                    }
                    return [2 /*return*/, candidates.sort(function (a, b) {
                            if (a.scopePriority !== b.scopePriority)
                                return a.scopePriority - b.scopePriority;
                            if (a.missingActionCount !== b.missingActionCount)
                                return b.missingActionCount - a.missingActionCount;
                            return a.contractKey.localeCompare(b.contractKey);
                        })];
            }
        });
    });
}
function resolveSolicitationIdFromContractAwards(awards, candidate) {
    var candidatePiid = normalizeText(candidate.piid);
    var candidateRef = normalizeText(candidate.referencedIdvPiid);
    var exactPiidMatches = awards.filter(function (row) { return normalizeText(row.piid) === candidatePiid; });
    var exactRefMatches = candidateRef.length > 0
        ? awards.filter(function (row) { return normalizeText(row.referencedIdvPiid) === candidateRef; })
        : [];
    var scopedRows = exactPiidMatches.length ? exactPiidMatches : exactRefMatches.length ? exactRefMatches : awards;
    var solicitationIds = uniqueNonEmptyStrings(scopedRows.map(function (row) { return row.solicitationId; }));
    if (solicitationIds.length === 1) {
        return { solicitationId: solicitationIds[0], ambiguous: false };
    }
    return { solicitationId: null, ambiguous: solicitationIds.length > 1 };
}
function backfillSolicitationIdForContractActions(supabase, contractId, solicitationId) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, supabase
                        .from('artemis_contract_actions')
                        .update({
                        solicitation_id: solicitationId,
                        updated_at: new Date().toISOString()
                    })
                        .eq('contract_id', contractId)
                        .is('solicitation_id', null)
                        .select('id')];
                case 1:
                    _a = _b.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    return [2 /*return*/, (data || []).length];
            }
        });
    });
}
function upsertSamContractAwardRows(supabase, input) {
    return __awaiter(this, void 0, void 0, function () {
        var nowIso, rows, total, _i, _a, chunk, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!input.response.awards.length)
                        return [2 /*return*/, 0];
                    nowIso = new Date().toISOString();
                    rows = input.response.awards.map(function (award) {
                        var rawRow = safeRecord(award.metadata);
                        var rowHash = deterministicHash(stableJsonStringify(rawRow));
                        var rowKey = [
                            input.candidate.contractId,
                            award.solicitationId || 'na',
                            award.piid || 'na',
                            award.referencedIdvPiid || 'na',
                            rowHash
                        ].join('|');
                        return {
                            row_key: rowKey,
                            contract_id: input.candidate.contractId,
                            contract_key: input.candidate.contractKey,
                            mission_key: input.candidate.missionKey,
                            program_scope: input.candidate.programScope,
                            solicitation_id: award.solicitationId,
                            piid: award.piid,
                            referenced_idv_piid: award.referencedIdvPiid,
                            response_status: input.response.status,
                            source_document_id: input.sourceDocumentId,
                            metadata: {
                                row: rawRow,
                                rowHash: rowHash,
                                extraction: {
                                    solicitationId: award.solicitationId,
                                    piid: award.piid,
                                    referencedIdvPiid: award.referencedIdvPiid
                                },
                                candidate: {
                                    contractId: input.candidate.contractId,
                                    contractKey: input.candidate.contractKey,
                                    missionKey: input.candidate.missionKey,
                                    programScope: input.candidate.programScope,
                                    awardeeName: input.candidate.awardeeName,
                                    description: input.candidate.description
                                },
                                request: {
                                    method: input.response.method,
                                    url: input.response.url
                                },
                                response: {
                                    status: input.response.status,
                                    paging: input.response.paging
                                },
                                sourceModel: 'sam-contract-awards-row-capture'
                            },
                            updated_at: nowIso
                        };
                    });
                    total = 0;
                    _i = 0, _a = chunkArray(rows, UPSERT_CHUNK_SIZE);
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    chunk = _a[_i];
                    return [4 /*yield*/, supabase.from('artemis_sam_contract_award_rows').upsert(chunk, { onConflict: 'row_key' })];
                case 2:
                    error = (_b.sent()).error;
                    if (error)
                        throw error;
                    total += chunk.length;
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, total];
            }
        });
    });
}
function fetchSamContractAwards(input) {
    return __awaiter(this, void 0, void 0, function () {
        var requestedLimit, requestedOffset, url, method, response, body;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    requestedLimit = SAM_CONTRACT_AWARDS_LIMIT;
                    requestedOffset = 0;
                    url = new URL(input.apiUrl);
                    url.searchParams.set('api_key', input.apiKey);
                    url.searchParams.set('piid', input.candidate.piid);
                    if (input.candidate.referencedIdvPiid) {
                        url.searchParams.set('referencedIdvPiid', input.candidate.referencedIdvPiid);
                    }
                    url.searchParams.set('limit', String(requestedLimit));
                    url.searchParams.set('offset', String(requestedOffset));
                    method = 'GET';
                    return [4 /*yield*/, fetch(url.toString(), {
                            headers: {
                                Accept: 'application/json,*/*'
                            }
                        })];
                case 1:
                    response = _a.sent();
                    return [4 /*yield*/, parseApiResponsePayload(response)];
                case 2:
                    body = _a.sent();
                    return [2 /*return*/, {
                            ok: response.ok,
                            status: response.status,
                            url: sanitizeSamRequestUrl(url.toString()),
                            method: method,
                            awards: extractContractAwardRows(body),
                            paging: extractSamPaging(body, { requestedLimit: requestedLimit, requestedOffset: requestedOffset }),
                            body: body
                        }];
            }
        });
    });
}
function fetchSamOpportunities(input) {
    return __awaiter(this, void 0, void 0, function () {
        var dateWindow, requestedLimit, requestedOffset, url, response, body;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    dateWindow = input.dateWindow || buildSamOpportunityDateWindow(input.lookbackDays);
                    requestedLimit = SAM_OPPORTUNITIES_LIMIT;
                    requestedOffset = 0;
                    url = new URL(input.apiUrl);
                    url.searchParams.set('api_key', input.apiKey);
                    if (input.solicitationId) {
                        url.searchParams.set('solnum', input.solicitationId);
                    }
                    url.searchParams.set('postedFrom', formatSamDate(dateWindow.postedFrom));
                    url.searchParams.set('postedTo', formatSamDate(dateWindow.postedToUtc));
                    url.searchParams.set('limit', String(requestedLimit));
                    url.searchParams.set('offset', String(requestedOffset));
                    return [4 /*yield*/, fetch(url.toString(), {
                            headers: {
                                Accept: 'application/json,*/*'
                            }
                        })];
                case 1:
                    response = _a.sent();
                    return [4 /*yield*/, parseApiResponsePayload(response)];
                case 2:
                    body = _a.sent();
                    return [2 /*return*/, {
                            ok: response.ok,
                            status: response.status,
                            url: sanitizeSamRequestUrl(url.toString()),
                            dateWindow: {
                                requestedLookbackDays: dateWindow.requestedLookbackDays,
                                appliedLookbackDays: dateWindow.appliedLookbackDays,
                                postedFrom: formatSamDate(dateWindow.postedFrom),
                                postedTo: formatSamDate(dateWindow.postedToUtc),
                                clampReason: dateWindow.clampReason || null
                            },
                            notices: extractOpportunityNotices(body, input.solicitationId || ''),
                            paging: extractSamPaging(body, { requestedLimit: requestedLimit, requestedOffset: requestedOffset }),
                            body: body
                        }];
            }
        });
    });
}
function parseApiResponsePayload(response) {
    return __awaiter(this, void 0, void 0, function () {
        var text;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, response.text()];
                case 1:
                    text = _a.sent();
                    if (!text)
                        return [2 /*return*/, null];
                    try {
                        return [2 /*return*/, JSON.parse(text)];
                    }
                    catch (_b) {
                        return [2 /*return*/, { parseError: true, raw: text.slice(0, 2000) }];
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function extractSamPaging(payload, defaults) {
    var _a, _b, _c, _d, _e, _f;
    var root = safeRecord(payload);
    var totalRecords = (_c = (_b = (_a = numberOrNull(root.totalRecords)) !== null && _a !== void 0 ? _a : numberOrNull(root.totalrecords)) !== null && _b !== void 0 ? _b : numberOrNull(root.total_records)) !== null && _c !== void 0 ? _c : null;
    var limit = (_e = (_d = numberOrNull(root.limit)) !== null && _d !== void 0 ? _d : numberOrNull(root.pageSize)) !== null && _e !== void 0 ? _e : defaults.requestedLimit;
    var offset = (_f = numberOrNull(root.offset)) !== null && _f !== void 0 ? _f : defaults.requestedOffset;
    var truncated = totalRecords !== null &&
        limit !== null &&
        offset !== null &&
        totalRecords > 0 &&
        offset + limit < totalRecords;
    return {
        totalRecords: totalRecords,
        limit: limit,
        offset: offset,
        truncated: truncated
    };
}
function extractContractAwardRows(payload) {
    if (!payload || typeof payload !== 'object')
        return [];
    var root = payload;
    var candidates = [
        root.data,
        root.results,
        root.rows,
        root.awards,
        root.awardSummary,
        root.contractAwards,
        root.contract_awards,
        root.records
    ];
    var rows = candidates.find(function (candidate) { return Array.isArray(candidate); });
    if (!Array.isArray(rows))
        return [];
    return rows.map(function (row) {
        var data = safeRecord(row);
        var coreData = safeRecord(data.coreData);
        var oldContractId = safeRecord(data.oldContractId);
        var solicitation = safeRecord(data.solicitation);
        var contractId = safeRecord(data.contractId);
        var award = safeRecord(data.award);
        return {
            solicitationId: stringOrNull(readMetaString(data, 'solicitationId')) ||
                stringOrNull(readMetaString(data, 'solicitationID')) ||
                stringOrNull(readMetaString(data, 'solicitation_id')) ||
                stringOrNull(readMetaString(data, 'solicitationNumber')) ||
                stringOrNull(readMetaString(data, 'solicitation_number')) ||
                stringOrNull(readMetaString(coreData, 'solicitationId')) ||
                stringOrNull(readMetaString(coreData, 'solicitationID')) ||
                stringOrNull(readMetaString(coreData, 'solicitation_id')) ||
                stringOrNull(readMetaString(coreData, 'solicitationNumber')) ||
                stringOrNull(readMetaString(oldContractId, 'solicitationId')) ||
                stringOrNull(readMetaString(oldContractId, 'solicitationID')) ||
                stringOrNull(readMetaString(oldContractId, 'solicitation_id')) ||
                stringOrNull(readMetaString(contractId, 'solicitationId')) ||
                stringOrNull(readMetaString(contractId, 'solicitationID')) ||
                stringOrNull(readMetaString(solicitation, 'id')) ||
                stringOrNull(readMetaString(solicitation, 'number')) ||
                stringOrNull(readMetaString(award, 'solicitationId')) ||
                null,
            piid: stringOrNull(readMetaString(data, 'piid')) ||
                stringOrNull(readMetaString(data, 'PIID')) ||
                stringOrNull(readMetaString(data, 'awardId')) ||
                stringOrNull(readMetaString(data, 'award_id')) ||
                stringOrNull(readMetaString(contractId, 'piid')) ||
                stringOrNull(readMetaString(contractId, 'PIID')) ||
                stringOrNull(readMetaString(award, 'piid')) ||
                stringOrNull(readMetaString(award, 'awardId')) ||
                null,
            referencedIdvPiid: stringOrNull(readMetaString(data, 'referencedIdvPiid')) ||
                stringOrNull(readMetaString(data, 'referencedIDVPIID')) ||
                stringOrNull(readMetaString(data, 'referenced_idv_piid')) ||
                stringOrNull(readMetaString(contractId, 'referencedIdvPiid')) ||
                stringOrNull(readMetaString(contractId, 'referencedIDVPIID')) ||
                stringOrNull(readMetaString(contractId, 'referenced_idv_piid')) ||
                stringOrNull(readMetaString(award, 'referencedIdvPiid')) ||
                stringOrNull(readMetaString(award, 'referenced_idv_piid')) ||
                null,
            metadata: data
        };
    });
}
function readStringFromRecord(record, keys) {
    for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
        var key = keys_1[_i];
        var value = record[key];
        if (typeof value === 'string' && value.trim().length > 0)
            return value.trim();
    }
    return null;
}
function readSamErrorMetadata(payload, keys) {
    var root = safeRecord(payload);
    return (readStringFromRecord(root, keys) ||
        readStringFromRecord(safeRecord(root.error), keys) ||
        readStringFromRecord(safeRecord(root.errors), keys) ||
        null);
}
function classifySamStopReason(status, payload) {
    var errorCode = readSamErrorMetadata(payload, ['code', 'errorCode', 'error_code']);
    var errorMessage = (readSamErrorMetadata(payload, ['message', 'errorMessage', 'description']) || '').toLowerCase();
    var normalizedCode = (errorCode || '').toLowerCase();
    var isThrottled = normalizedCode.includes('throttl') ||
        normalizedCode.includes('over_rate') ||
        errorMessage.includes('throttl') ||
        errorMessage.includes('over_rate') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests');
    if (status === 429 || (status === 403 && isThrottled))
        return 'sam_quota_throttled';
    if (status === 401 || status === 403)
        return "sam_auth_error_".concat(status);
    if (status === 404)
        return 'sam_http_404_not_found';
    return null;
}
function sanitizeSamRequestUrl(value) {
    try {
        var url = new URL(value);
        url.searchParams.delete('api_key');
        url.searchParams.delete('apiKey');
        url.searchParams.delete('apikey');
        return url.toString();
    }
    catch (_a) {
        return value;
    }
}
function extractOpportunityNotices(payload, solicitationId) {
    var rows = extractRows(payload);
    var nowIso = new Date().toISOString();
    return rows
        .map(function (row) {
        var data = safeRecord(row);
        var noticeId = stringOrNull(readMetaString(data, 'noticeId')) ||
            stringOrNull(readMetaString(data, 'notice_id')) ||
            stringOrNull(readMetaString(data, 'id')) ||
            stringOrNull(readMetaString(data, 'uiLink')) ||
            null;
        if (!noticeId)
            return null;
        var title = stringOrNull(readMetaString(data, 'title')) || stringOrNull(readMetaString(data, 'solicitationTitle'));
        var postedDate = dateOnlyOrNull(readMetaString(data, 'postedDate')) ||
            dateOnlyOrNull(readMetaString(data, 'publishDate')) ||
            dateOnlyOrNull(readMetaString(data, 'archiveDate'));
        var responseDeadline = stringOrNull(readMetaString(data, 'responseDeadLine')) ||
            stringOrNull(readMetaString(data, 'response_deadline')) ||
            null;
        var awardAmount = numberOrNull(readMetaString(data, 'awardAmount')) || numberOrNull(safeRecord(data.award).amount) || null;
        var attachmentCount = Array.isArray(data.attachments)
            ? data.attachments.length
            : numberOrNull(readMetaString(data, 'attachmentCount'));
        return {
            notice_id: noticeId,
            solicitation_id: stringOrNull(readMetaString(data, 'solicitationNumber')) ||
                stringOrNull(readMetaString(data, 'solicitationId')) ||
                stringOrNull(readMetaString(data, 'solicitationID')) ||
                solicitationId,
            ptype: stringOrNull(readMetaString(data, 'ptype')) || stringOrNull(readMetaString(data, 'type')),
            title: title,
            posted_date: postedDate,
            response_deadline: responseDeadline,
            latest_active_version: true,
            awardee_name: stringOrNull(readMetaString(data, 'awardeeName')) || stringOrNull(safeRecord(data.award).awardee) || null,
            award_amount: awardAmount,
            notice_url: stringOrNull(readMetaString(data, 'uiLink')) ||
                stringOrNull(readMetaString(data, 'noticeUrl')) ||
                stringOrNull(readMetaString(data, 'link')) ||
                null,
            attachment_count: attachmentCount,
            source_document_id: null,
            metadata: data,
            updated_at: nowIso
        };
    })
        .filter(function (row) { return Boolean(row); });
}
function extractRows(payload) {
    if (!payload || typeof payload !== 'object')
        return [];
    var root = payload;
    var candidates = [
        root.data,
        root.results,
        root.rows,
        root.opportunitiesData,
        root.opportunities,
        root.notice,
        root.notices
    ];
    for (var _i = 0, candidates_2 = candidates; _i < candidates_2.length; _i++) {
        var candidate = candidates_2[_i];
        if (Array.isArray(candidate))
            return candidate;
    }
    return [];
}
function upsertOpportunityNotices(supabase, notices) {
    return __awaiter(this, void 0, void 0, function () {
        var _i, _a, chunk, error;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _i = 0, _a = chunkArray(notices, UPSERT_CHUNK_SIZE);
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    chunk = _a[_i];
                    return [4 /*yield*/, supabase.from('artemis_opportunity_notices').upsert(chunk, { onConflict: 'notice_id' })];
                case 2:
                    error = (_b.sent()).error;
                    if (error)
                        throw error;
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function attachNoticeToActions(supabase, solicitationId, noticeId) {
    return __awaiter(this, void 0, void 0, function () {
        var error;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!noticeId)
                        return [2 /*return*/];
                    return [4 /*yield*/, supabase
                            .from('artemis_contract_actions')
                            .update({ sam_notice_id: noticeId, updated_at: new Date().toISOString() })
                            .eq('solicitation_id', solicitationId)
                            .is('sam_notice_id', null)];
                case 1:
                    error = (_a.sent()).error;
                    if (error)
                        throw error;
                    return [2 /*return*/];
            }
        });
    });
}
function disableArtemisContractsJob(supabase, reason, context) {
    return __awaiter(this, void 0, void 0, function () {
        var payload, error;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    payload = {
                        reason: reason,
                        disabledAt: new Date().toISOString(),
                        context: context
                    };
                    return [4 /*yield*/, supabase
                            .from('system_settings')
                            .upsert([
                            { key: SETTING_CONTRACTS_JOB_ENABLED, value: false },
                            { key: SETTING_CONTRACTS_JOB_DISABLED_REASON, value: payload }
                        ], { onConflict: 'key' })];
                case 1:
                    error = (_a.sent()).error;
                    if (error)
                        throw error;
                    return [2 /*return*/];
            }
        });
    });
}
function uniqueNonEmptyStrings(values) {
    var seen = new Set();
    for (var _i = 0, values_1 = values; _i < values_1.length; _i++) {
        var value = values_1[_i];
        var normalized = stringOrNull(value);
        if (!normalized)
            continue;
        seen.add(normalized);
    }
    return __spreadArray([], seen, true);
}
function readMetaString(metadata, key) {
    var value = metadata[key];
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function inferContractType(metadata, referencedIdvPiid) {
    var source = normalizeText(readMetaString(metadata, 'awardType') || readMetaString(metadata, 'award_type'));
    if (source.includes('idv') || source.includes('indefinite'))
        return 'idv';
    if (referencedIdvPiid)
        return 'order';
    if (source.includes('contract') || source.includes('award'))
        return 'definitive';
    return 'unknown';
}
function buildContractKey(piid, referencedIdvPiid) {
    return [piid.trim(), (referencedIdvPiid === null || referencedIdvPiid === void 0 ? void 0 : referencedIdvPiid.trim()) || ''].join('|');
}
function deterministicHash(input) {
    var hash = 2166136261;
    for (var i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function stableJsonStringify(value) {
    return JSON.stringify(sortForStableJson(value));
}
function sortForStableJson(value) {
    if (Array.isArray(value)) {
        return value.map(function (entry) { return sortForStableJson(entry); });
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    var input = value;
    var output = {};
    for (var _i = 0, _a = Object.keys(input).sort(); _i < _a.length; _i++) {
        var key = _a[_i];
        output[key] = sortForStableJson(input[key]);
    }
    return output;
}
function chunkArray(rows, size) {
    if (rows.length === 0)
        return [];
    var chunks = [];
    for (var i = 0; i < rows.length; i += size) {
        chunks.push(rows.slice(i, i + size));
    }
    return chunks;
}
