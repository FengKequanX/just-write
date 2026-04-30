#!/bin/bash
# Update bundled sub-skills from upstream sources
set -e

echo "=== wechat-content-studio plugin: updating sub-skills ==="

update_git() {
    local dir="$1"
    local repo="$2"
    if [ -d "$dir/.git" ]; then
        echo "  Updating $(basename "$dir")..."
        git -C "$dir" pull origin main
    else
        echo "  Cloning $(basename "$dir") from $repo..."
        rm -rf "$dir"
        git clone --depth 1 "$repo" "$dir"
    fi
}

# baoyu-post-to-wechat (JimLiu/baoyu-skills subdirectory)
# Note: this is a subdirectory, clone the whole repo then copy
echo "[baoyu-post-to-wechat]"
TMPDIR=$(mktemp -d)
git clone --depth 1 https://github.com/JimLiu/baoyu-skills.git "$TMPDIR" 2>/dev/null
cp -r "$TMPDIR/skills/baoyu-post-to-wechat/SKILL.md" skills/baoyu-post-to-wechat/
cp -r "$TMPDIR/skills/baoyu-post-to-wechat/scripts/" skills/baoyu-post-to-wechat/scripts/
rm -rf "$TMPDIR"

# humanizer-zh (op7418/Humanizer-zh)
echo "[humanizer-zh]"
TMPDIR=$(mktemp -d)
git clone --depth 1 https://github.com/op7418/Humanizer-zh.git "$TMPDIR" 2>/dev/null
cp "$TMPDIR/SKILL.md" skills/humanizer-zh/
rm -rf "$TMPDIR"

# viral-title - no upstream, bundled as-is
echo "[viral-title] (bundled, no upstream)"

# brainstorming (obra/superpowers)
echo "[brainstorming]"
TMPDIR=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse https://github.com/obra/superpowers.git "$TMPDIR" 2>/dev/null
git -C "$TMPDIR" sparse-checkout set skills/brainstorming
cp "$TMPDIR/skills/brainstorming/SKILL.md" skills/brainstorming/
rm -rf "$TMPDIR"

# image-prompt-engineer - bundled, no upstream
echo "[image-prompt-engineer] (bundled, no upstream)"

echo "=== Update complete ==="
