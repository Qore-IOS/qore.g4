"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUserGroupNames = exports.filterItemsForUserGroups = exports.loadLojistikUsers = exports.loadLabGroupNamesByDocId = exports.groupMapFromInfo = exports.buildItemInfoMap = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_functions_1 = require("firebase-functions");
const db = admin.firestore();
const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
};
/**
 * Build a map: stokKodu -> { group, anaBirim, ambalajDegeri } by reading productCodes.
 * Item-level fields (laboratuvarGrubu/anaBirim/ambalajDegeri), when present on the
 * order item, win over the productCodes lookup so callers can override per-order.
 */
async function buildItemInfoMap(items) {
    const infoMap = new Map();
    const codesToFetch = new Set();
    for (const it of items) {
        const code = (it.stokKodu || '').trim();
        if (!code)
            continue;
        const seed = {
            group: it.laboratuvarGrubu ? String(it.laboratuvarGrubu).trim() : '',
            anaBirim: it.anaBirim ? String(it.anaBirim).trim() : undefined,
            ambalajDegeri: typeof it.ambalajDegeri === 'number' ? it.ambalajDegeri : undefined,
        };
        infoMap.set(code, seed);
        if (!seed.group || seed.anaBirim === undefined || seed.ambalajDegeri === undefined) {
            codesToFetch.add(code);
        }
    }
    if (codesToFetch.size === 0)
        return infoMap;
    try {
        const batches = chunk(Array.from(codesToFetch), 10);
        for (const batch of batches) {
            const snap = await db
                .collection('productCodes')
                .where('stokKodu', 'in', batch)
                .get();
            snap.docs.forEach((d) => {
                const data = d.data();
                const code = ((data === null || data === void 0 ? void 0 : data.stokKodu) || '').trim();
                if (!code)
                    return;
                const existing = infoMap.get(code) || { group: '' };
                if (!existing.group && (data === null || data === void 0 ? void 0 : data.laboratuvarGrubu)) {
                    existing.group = String(data.laboratuvarGrubu).trim();
                }
                if (existing.anaBirim === undefined && (data === null || data === void 0 ? void 0 : data.anaBirim)) {
                    existing.anaBirim = String(data.anaBirim).trim();
                }
                if (existing.ambalajDegeri === undefined && (data === null || data === void 0 ? void 0 : data.ambalajDegeri) !== undefined && (data === null || data === void 0 ? void 0 : data.ambalajDegeri) !== null) {
                    const n = Number(data.ambalajDegeri);
                    if (Number.isFinite(n) && n > 0)
                        existing.ambalajDegeri = n;
                }
                infoMap.set(code, existing);
            });
        }
    }
    catch (e) {
        firebase_functions_1.logger.warn('[peripheralRecipients] productCodes lookup failed:', e);
    }
    return infoMap;
}
exports.buildItemInfoMap = buildItemInfoMap;
function groupMapFromInfo(info) {
    const out = new Map();
    info.forEach((v, k) => { if (v.group)
        out.set(k, v.group); });
    return out;
}
exports.groupMapFromInfo = groupMapFromInfo;
/** Load def_labGroups → Map<docId, name>. */
async function loadLabGroupNamesByDocId() {
    const map = new Map();
    try {
        const snap = await db.collection('def_labGroups').get();
        snap.docs.forEach((d) => {
            var _a;
            const name = (_a = d.data()) === null || _a === void 0 ? void 0 : _a.name;
            if (name)
                map.set(d.id, String(name).trim());
        });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[peripheralRecipients] def_labGroups load failed:', e);
    }
    return map;
}
exports.loadLabGroupNamesByDocId = loadLabGroupNamesByDocId;
/** Fetch all users with role=lojistik_sorumlusu, normalized. */
async function loadLojistikUsers() {
    const out = [];
    try {
        const snap = await db
            .collection('users')
            .where('role', '==', 'lojistik_sorumlusu')
            .get();
        snap.docs.forEach((d) => {
            const data = d.data();
            const groups = Array.isArray(data === null || data === void 0 ? void 0 : data.assignedLabGroups) ? data.assignedLabGroups.filter(Boolean) : [];
            out.push({
                uid: d.id,
                name: ((data === null || data === void 0 ? void 0 : data.name) || '').trim() || null,
                email: ((data === null || data === void 0 ? void 0 : data.email) || '').trim() || null,
                phoneNumber: ((data === null || data === void 0 ? void 0 : data.phoneNumber) || '').trim() || null,
                assignedLabGroups: groups,
            });
        });
    }
    catch (e) {
        firebase_functions_1.logger.warn('[peripheralRecipients] users load failed:', e);
    }
    return out;
}
exports.loadLojistikUsers = loadLojistikUsers;
/** Return items whose resolved laboratuvarGrubu is in the user's assigned group name set. */
function filterItemsForUserGroups(items, itemGroupMap, userGroupNames) {
    if (userGroupNames.size === 0)
        return [];
    return items.filter((it) => {
        const code = (it.stokKodu || '').trim();
        if (!code)
            return false;
        const group = itemGroupMap.get(code);
        if (!group)
            return false;
        return userGroupNames.has(group);
    });
}
exports.filterItemsForUserGroups = filterItemsForUserGroups;
/** Resolve a lojistik user's assigned group IDs or names to group names via def_labGroups. */
function resolveUserGroupNames(user, labGroupNamesById) {
    const out = new Set();
    const knownNames = new Set(labGroupNamesById.values());
    for (const idOrName of user.assignedLabGroups) {
        const nameFromId = labGroupNamesById.get(idOrName);
        if (nameFromId) {
            out.add(nameFromId);
        }
        else {
            // If not an ID, use it directly. 
            // It might be a name already saved by the UI, or a legacy name.
            out.add(idOrName);
            if (!knownNames.has(idOrName)) {
                firebase_functions_1.logger.debug(`[peripheralRecipients] User ${user.uid} has assigned group "${idOrName}" which is not in def_labGroups.`);
            }
        }
    }
    return out;
}
exports.resolveUserGroupNames = resolveUserGroupNames;
//# sourceMappingURL=peripheralRecipients.js.map