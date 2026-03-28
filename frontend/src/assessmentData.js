/** Mirrors backend question IDs (opt0 / opt1 / opt2). Max aggregate score: 2000. */

const OPTS = [
  { id: "opt0", label: "Insufficient / not in place" },
  { id: "opt1", label: "Partial / in progress" },
  { id: "opt2", label: "Strong / fully implemented" },
];

export const ASSESSMENT_DATA = {
  q1_mfa: {
    text: "Do users have Multi-Factor Authentication (MFA) enabled?",
    category: "Identity & access",
    options: OPTS,
  },
  q2_remote: {
    text: "How is remote network access secured?",
    category: "Remote access",
    options: OPTS,
  },
  q3_privilege: {
    text: "Are administrative rights restricted to necessary personnel only?",
    category: "Privilege management",
    options: OPTS,
  },
  q4_offboarding: {
    text: "Are access rights revoked immediately when an employee leaves?",
    category: "Identity lifecycle",
    options: OPTS,
  },
  q5_encryption_rest: {
    text: "Are hard drives on company laptops fully encrypted?",
    category: "Data protection",
    options: OPTS,
  },
  q6_encryption_transit: {
    text: "Is sensitive data encrypted when shared over email or file transfers?",
    category: "Data protection",
    options: OPTS,
  },
  q7_backup_freq: {
    text: "Are critical systems and data backed up automatically?",
    category: "Resilience",
    options: OPTS,
  },
  q8_backup_test: {
    text: "How often are backups tested for successful restoration?",
    category: "Resilience",
    options: OPTS,
  },
  q9_irp: {
    text: "Do you have a written Incident Response Plan (IRP)?",
    category: "Incident response",
    options: OPTS,
  },
  q10_logs: {
    text: "Are system and network logs retained and reviewed?",
    category: "Monitoring & forensics",
    options: OPTS,
  },
  q11_training: {
    text: "How frequently do employees undergo security awareness training?",
    category: "Security awareness",
    options: OPTS,
  },
  q12_phishing: {
    text: "Do you conduct simulated phishing tests on employees?",
    category: "Security awareness",
    options: OPTS,
  },
  q13_reporting: {
    text: "Is there a clear, known process for employees to report suspicious activity?",
    category: "Operations",
    options: OPTS,
  },
  q14_vendor: {
    text: "Do you assess the security posture of third-party vendors?",
    category: "Third party",
    options: OPTS,
  },
  q15_shadow_it: {
    text: "Do you control and monitor the use of unsanctioned cloud apps?",
    category: "Cloud & shadow IT",
    options: OPTS,
  },
  q16_patching: {
    text: "Are operating systems and third-party applications updated automatically?",
    category: "Vulnerability management",
    options: OPTS,
  },
  q17_edr: {
    text: "Are endpoints protected by modern Antivirus or EDR software?",
    category: "Endpoint security",
    options: OPTS,
  },
  q18_wifi: {
    text: "Is the corporate Wi-Fi network segmented from guest access?",
    category: "Network security",
    options: OPTS,
  },
  q19_physical: {
    text: "Is physical access to servers and network equipment restricted?",
    category: "Physical security",
    options: OPTS,
  },
  q20_bcp: {
    text: "Do you have a Business Continuity Plan to operate during an outage?",
    category: "Business continuity",
    options: OPTS,
  },
};

export const QUESTION_ORDER = Object.keys(ASSESSMENT_DATA);
