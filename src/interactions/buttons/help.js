import {
  helpBackButton,
  helpBugReportButton,
  helpPaginationButton,
} from '../../handlers/helpButtons.js';

const paginationIds = [
  'help-page_first',
  
];

const paginationInteractions = paginationIds.map((name) => ({
  name,
  execute: helpPaginationButton.execute,
}));

export default [helpBackButton, helpBugReportButton, ...paginationInteractions];
