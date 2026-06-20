// src/interactions/buttons/createkey.js
import { createkeyOpenModalHandler } from '../../handlers/createkeyFlow.js';
import {
    getkeyCustomHandler,
    getkeyDaysHandler,
    getkeyConfirmHandler,
    getkeyCancelNearestHandler,
} from '../../handlers/getkeyFlow.js';

export default [
    createkeyOpenModalHandler,
    getkeyCustomHandler,
    getkeyDaysHandler,
    getkeyConfirmHandler,
    getkeyCancelNearestHandler,
];
