// src/interactions/modals/createkey.js
import { createkeyModalHandler } from '../../handlers/createkeyFlow.js';
import {
    getkeyCustomDaysModalHandler,
} from '../../handlers/getkeyFlow.js';

export default [
    createkeyModalHandler,
    getkeyCustomDaysModalHandler,
];
