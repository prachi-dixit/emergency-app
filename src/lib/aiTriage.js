// src/lib/aiTriage.js
// Agentic AI & ML Triage Engine for Emergency Classification

const CRITICAL_KEYWORDS = [
  'unconscious', 'not breathing', 'heart attack', 'cardiac', 'stroke', 'heavy bleeding', 
  'massive bleeding', 'gunshot', 'stab', 'head injury', 'severe burns', 'explosion', 
  'trapped in car', 'structure collapse', 'drowning', 'choking', 'cyanosis', 'severe collision'
]

const HIGH_KEYWORDS = [
  'fracture', 'broken bone', 'fire spreading', 'smoke inhalation', 'chest pain',
  'breathless', 'deep cut', 'assault', 'armed robbery', 'road accident', 'bike crash',
  'electric shock', 'snake bite', 'poison', 'high fever infant', 'violence'
]

const MEDIUM_KEYWORDS = [
  'small fire', 'trash fire', 'sprain', 'minor accident', 'fainting', 'theft',
  'burglary', 'vandalism', 'dog bite', 'dizziness', 'water leak', 'property damage',
  'dispute', 'stranded'
]

const FIRST_AID_KNOWLEDGE = {
  medical: [
    'Check responsiveness and clear airways immediately.',
    'If unconscious and not breathing normally, begin CPR (30 chest compressions at 100-120 bpm followed by 2 rescue breaths).',
    'For severe bleeding, apply firm direct pressure with a clean cloth. Do not remove saturated bandages; layer more on top.',
    'Keep patient warm, calm, and lying flat unless experiencing breathing difficulty.'
  ],
  fire: [
    'Evacuate immediately! Do not re-enter burning structures for possessions.',
    'Stay low under smoke where air is cooler and cleaner.',
    'Test closed door handles with back of hand before opening.',
    'If clothes catch fire: Stop, Drop, and Roll.'
  ],
  accident: [
    'Do NOT move injured victims unless there is immediate danger of fire or explosion (protect spine/neck).',
    'Turn off vehicle ignition to prevent electrical fire.',
    'Set up warning triangles or hazards 50m behind incident site to alert oncoming traffic.',
    'Keep injured individuals calm, still, and covered with a blanket.'
  ],
  crime: [
    'Prioritize personal safety: move to a well-lit, crowded, or locked area.',
    'Do not confront armed or aggressive individuals.',
    'Preserve evidence and take mental notes of descriptions/vehicle numbers.',
    'Stay on the line with dispatchers until law enforcement arrives.'
  ],
  other: [
    'Assess surroundings for ongoing hazards (falling objects, live wires, traffic).',
    'Establish a safe perimeter and await trained responders.',
    'Keep your phone line open for responder updates.'
  ]
}

const RESPONSE_UNITS = {
  medical: {
    1: 'Advanced Life Support (ALS) Ambulance + Paramedic Team',
    2: 'Basic Life Support (BLS) Ambulance',
    3: 'Community First-Aid Responder / Mobile Clinic',
    4: 'Local Health Center / Tele-Consult'
  },
  fire: {
    1: 'Heavy Rescue Fire Engine + HazMat Specialist',
    2: 'Rapid Intervention Water Tender',
    3: 'Local Fire Auxiliary Unit',
    4: 'Safety Inspection Team'
  },
  accident: {
    1: 'Multi-Agency Response (Ambulance + Highway Patrol + Fire Cutter)',
    2: 'Ambulance + Traffic Police Patrol',
    3: 'Local Tow & Traffic Assistance Unit',
    4: 'Community Volunteer Support'
  },
  crime: {
    1: 'Armed Police Rapid Response Team (PCR)',
    2: 'Local Police Patrol Mobile Unit',
    3: 'Community Beat Officer',
    4: 'Station Reporting Support'
  },
  other: {
    1: 'Emergency Disaster Relief Team',
    2: 'Civic Quick Reaction Unit',
    3: 'Community Support Team',
    4: 'Information Helpdesk'
  }
}

export function classifyEmergency(type = 'other', description = '') {
  const normType = (type || 'other').toLowerCase()
  const text = (description || '').toLowerCase()

  const detectedCritical = CRITICAL_KEYWORDS.filter((k) => text.includes(k))
  const detectedHigh = HIGH_KEYWORDS.filter((k) => text.includes(k))
  const detectedMedium = MEDIUM_KEYWORDS.filter((k) => text.includes(k))

  let severity
  let confidence
  let reason

  if (detectedCritical.length > 0) {
    severity = 1
    confidence = Math.min(99, 90 + detectedCritical.length * 3)
    reason = `Critical risk detected: [${detectedCritical.join(', ')}]. Immediate priority dispatch.`
  } else if (detectedHigh.length > 0) {
    severity = 2
    confidence = Math.min(95, 84 + detectedHigh.length * 3)
    reason = `Urgent condition detected: [${detectedHigh.join(', ')}]. Rapid response recommended.`
  } else if (detectedMedium.length > 0) {
    severity = 3
    confidence = Math.min(90, 80 + detectedMedium.length * 3)
    reason = `Moderate incident detected: [${detectedMedium.join(', ')}]. Standard response unit required.`
  } else {
    // If no keywords matched, base on emergency category defaults
    if (normType === 'medical' || normType === 'fire') {
      severity = 2
      confidence = 78
      reason = `${normType.toUpperCase()} incidents default to elevated urgency pending assessment.`
    } else if (normType === 'accident') {
      severity = 2
      confidence = 75
      reason = 'Traffic collision requires safety patrol and medical check.'
    } else if (normType === 'crime') {
      severity = 2
      confidence = 74
      reason = 'Law enforcement dispatch recommended.'
    } else {
      severity = 4
      confidence = 70
      reason = 'General inquiry or minor report.'
    }
  }

  const severityLabels = {
    1: 'Critical (P1)',
    2: 'High (P2)',
    3: 'Moderate (P3)',
    4: 'Low (P4)'
  }

  const urgencyLevels = {
    1: 'Life-Threatening Emergency',
    2: 'Urgent Intervention Needed',
    3: 'Prompt Attention Required',
    4: 'Non-Urgent / Routine Support'
  }

  const typeUnits = RESPONSE_UNITS[normType] || RESPONSE_UNITS.other
  const recommendedUnit = typeUnits[severity] || typeUnits[2]
  const firstAid = FIRST_AID_KNOWLEDGE[normType] || FIRST_AID_KNOWLEDGE.other

  return {
    severity,
    severityLabel: severityLabels[severity],
    urgency: urgencyLevels[severity],
    confidence,
    reason,
    detectedKeywords: [...detectedCritical, ...detectedHigh, ...detectedMedium],
    recommendedUnit,
    firstAidGuidance: firstAid,
    escalationThresholdSeconds: severity === 1 ? 25 : severity === 2 ? 45 : 90
  }
}
