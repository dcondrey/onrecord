#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root after `gh auth status` succeeds.
# The script never prints or stores the token; it uses gh's credential helper.

repo_owner="writerslogic"
repo_name="onrecord"
command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
gh auth status >/dev/null

repo_json="$(gh api graphql -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id,hasDiscussionsEnabled,discussionCategories(first:50){nodes{id,name}}}}' -F owner="$repo_owner" -F name="$repo_name")"
if [[ "$(jq -r '.data.repository.hasDiscussionsEnabled' <<<"$repo_json")" != "true" ]]; then
  echo "GitHub Discussions are not enabled for $repo_owner/$repo_name." >&2; exit 1
fi
repo_id="$(jq -r '.data.repository.id' <<<"$repo_json")"

category_id() {
  jq -r --arg category "$1" '.data.repository.discussionCategories.nodes[] | select(.name == $category) | .id' <<<"$repo_json" | head -n 1
}

topics=(
  "Pilot Design|01-first-pilot.md|What should the first governed pilot do?"
  "Community Experience|02-recovery-card.md|What would make a recovery card usable?"
  "Safety & Privacy|03-public-private-boundary.md|Public map, private service layer"
  "Safety & Privacy|04-moderation-and-mutual-aid.md|Mutual aid without harassment or voyeurism"
  "Provider & Government Practice|05-provider-participation.md|Provider participation without punitive scorekeeping"
  "Community Experience|06-field-accessibility.md|Accessibility in the field"
  "Provider & Government Practice|07-hmis-boundary.md|What should never be integrated with HMIS?"
)

for topic in "${topics[@]}"; do
  IFS='|' read -r category file title <<<"$topic"
  category_id_value="$(category_id "$category")"
  if [[ -z "$category_id_value" ]]; then
    echo "Missing category: $category" >&2
    echo "Create/rename categories using docs/discussions/categories.md, then rerun." >&2
    exit 1
  fi
  existing="$(gh api graphql -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:100){nodes{title,url}}}}' -F owner="$repo_owner" -F name="$repo_name")"
  if jq -e --arg title "$title" '.data.repository.discussions.nodes[] | select(.title == $title)' <<<"$existing" >/dev/null; then
    echo "Already exists: $title"; continue
  fi
  body="$(<"docs/discussions/$file")"
  result="$(gh api graphql -f query='mutation($repo:ID!,$cat:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$cat,title:$title,body:$body}){discussion{title,url}}}' -F repo="$repo_id" -F cat="$category_id_value" -F title="$title" -F body="$body")"
  jq -r '.data.createDiscussion.discussion | "Created: \(.title) — \(.url)"' <<<"$result"
done
