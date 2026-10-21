#!/bin/sh
# Publishes the guides to the Help page. The FIELD editions (no HQ, admin or confidential parts) go to everyone on staff;
# the full editions go to HQ only. Build the field editions first: python3 tools/field_edition.py
B="$HOME/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build"
CODE=$(awk 'NR==1{print $NF}' "$B/04_Staff_Roster_RESTRICTED/HQ_ACCESS_CODE.txt" | tr -d '\r\n ')
URL="https://kf-assessments.learnimpacttz.workers.dev/api/admin/doc"
up() { curl -s -X POST "$URL?id=$1&order=$2&version=$3&filename=$4&title=$5&hq=$6" -H "x-access-code: $CODE" --data-binary @"$B/$7" -H 'content-type: application/octet-stream'; echo; }
up quick 1 "Version%201.0" "LI-CC_Quick_Start.docx" "Quick%20start" 0 "Field_Edition/KF4_LI-CC_Quick_Start_FIELD.docx"
up guide 2 "Version%201.9" "LI-CC_User_Guide.docx" "User%20guide" 0 "Field_Edition/KF4_Field_Command_Centre_User_Guide_FIELD.docx"
up manual 3 "Version%200.7%20(interim)" "LI-CC_Operations_Manual.docx" "Field%20operations%20manual" 0 "Field_Edition/KF4_Field_Operations_Manual_FIELD_v0.7.docx"
up quickh 4 "Version%201.0" "LI-CC_Quick_Start_HQ.docx" "Quick%20start%20HQ" 1 "KF4_LI-CC_Quick_Start.docx"
up guideh 5 "Version%201.9" "LI-CC_User_Guide_HQ.docx" "User%20guide%20HQ" 1 "KF4_Field_Command_Centre_User_Guide.docx"
up manualh 6 "Version%200.7%20(interim)" "LI-CC_Operations_Manual_HQ.docx" "Operations%20manual%20HQ" 1 "KF4_Field_Operations_Manual_INTERIM_v0.7.docx"
