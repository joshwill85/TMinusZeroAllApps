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
exports.getSettings = getSettings;
exports.readStringSetting = readStringSetting;
exports.readBooleanSetting = readBooleanSetting;
exports.readNumberSetting = readNumberSetting;
exports.readStringArraySetting = readStringArraySetting;
function getSettings(client, keys) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, data, error, out, _i, _b, row;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!keys.length)
                        return [2 /*return*/, {}];
                    return [4 /*yield*/, client.from('system_settings').select('key, value').in('key', keys)];
                case 1:
                    _a = _c.sent(), data = _a.data, error = _a.error;
                    if (error)
                        throw error;
                    out = {};
                    for (_i = 0, _b = data || []; _i < _b.length; _i++) {
                        row = _b[_i];
                        out[row.key] = row.value;
                    }
                    return [2 /*return*/, out];
            }
        });
    });
}
function readStringSetting(value, fallback) {
    if (fallback === void 0) { fallback = ''; }
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number')
        return String(value);
    return fallback;
}
function readBooleanSetting(value, fallback) {
    if (fallback === void 0) { fallback = false; }
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string')
        return value.toLowerCase() === 'true';
    return fallback;
}
function readNumberSetting(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}
function readStringArraySetting(value, fallback) {
    if (fallback === void 0) { fallback = []; }
    if (Array.isArray(value)) {
        return value.map(function (item) { return String(item).trim(); }).filter(Boolean);
    }
    if (typeof value === 'string') {
        var trimmed = value.trim();
        if (!trimmed)
            return fallback;
        if (trimmed.startsWith('[')) {
            try {
                var parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map(function (item) { return String(item).trim(); }).filter(Boolean);
                }
            }
            catch (_a) {
                return trimmed.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
            }
        }
        return trimmed.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
    }
    return fallback;
}
