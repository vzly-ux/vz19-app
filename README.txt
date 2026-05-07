VZ-19 Pro Max v3.1
==================

SETUP NETLIFY (étape obligatoire) :
=====================================

1. Déploie le ZIP sur Netlify comme d'habitude

2. Sur Netlify → ton site → "Site configuration"
   → "Environment variables" → "Add a variable"
   
   Nom : ANTHROPIC_API_KEY
   Valeur : (ta clé Claude — elle est gérée par l'app)

3. Redéploie le site (Deploys → Trigger deploy)

C'est tout ! Claude fonctionnera sans erreur CORS.

WORKFLOW :
1. Scouting → copie prompt → Gemini → colle liste
2. "Claude choisit les meilleurs matchs" → 2 SAFE + 1 VALUE
3. Appuie sur un match
4. Copie prompt stats → Gemini → colle réponse
5. "Analyser avec Claude" → Verdict VZ-19 automatique
