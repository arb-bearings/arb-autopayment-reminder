import { updateDatabase } from "../lib/storage";
import { createDefaultRuleSet } from "../lib/defaults";

async function main() {
  console.log("Syncing templates...");
  await updateDatabase((database) => {
    // Collect all workspace IDs
    const workspaces = Array.from(new Set(database.reminderRules.map(r => r.ownerId).filter(Boolean)));
    
    // For each workspace, replace the old templates with the newly generated default templates
    for (const workspaceId of workspaces) {
      const { templates } = createDefaultRuleSet(workspaceId);
      
      // Update each existing template with the body/subject from the canonical default
      for (const t of templates) {
        const existingTemplate = database.templates.find(
          dbT => dbT.ownerId === workspaceId && dbT.name === t.name
        );
        if (existingTemplate) {
          existingTemplate.emailBody = t.emailBody;
          existingTemplate.emailSubject = t.emailSubject;
          existingTemplate.whatsappBody = t.whatsappBody;
          existingTemplate.smsBody = t.smsBody;
        }
      }
    }
  });
  console.log("Templates successfully synced with defaults!");
}

main().catch(console.error);
