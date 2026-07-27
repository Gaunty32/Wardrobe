<?php
/**
 * Plugin Name: SBS Product Guidance
 * Plugin URI:  https://selectbranding.co.uk
 * Description: Displays star ratings, badges, Best For / Not Ideal For on WooCommerce product pages, with admin meta boxes and CSV bulk import/export.
 * Version:     1.0.0
 * Author:      Select Branding Solutions
 * Text Domain: sbs-guidance
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 8.0
 */

defined('ABSPATH') || exit;

// ── Constants ─────────────────────────────────────────────────────────────────
define('SBS_GUIDANCE_VERSION', '1.0.0');
define('SBS_GUIDANCE_FILE',    __FILE__);
define('SBS_GUIDANCE_DIR',     plugin_dir_path(__FILE__));
define('SBS_GUIDANCE_URL',     plugin_dir_url(__FILE__));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p><strong>SBS Product Guidance</strong> requires WooCommerce to be active.</p></div>';
        });
        return;
    }
    new SBS_Guidance_Admin();
    new SBS_Guidance_Display();
    new SBS_Guidance_Bulk();
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Meta boxes on product editor
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Guidance_Admin {

    const BADGES = [
        'Most Popular', 'Best Value', 'Premium Choice', 'New Arrival',
        'Best Seller', 'Eco Friendly', 'Award Winner', 'Exclusive',
        'Sale', 'Staff Pick', 'Bulk Buy Discount',
    ];

    const TAGS = [
        'Everyday Workwear', 'Smart Uniform', 'Heavy Duty',
        'Budget Friendly', 'Premium',
    ];

    public function __construct() {
        add_action('add_meta_boxes', [$this, 'register_meta_box']);
        add_action('woocommerce_process_product_meta', [$this, 'save']);
    }

    public function register_meta_box(): void {
        add_meta_box(
            'sbs_product_guidance',
            '⭐ SBS Product Guidance',
            [$this, 'render'],
            'product',
            'normal',
            'default'
        );
    }

    public function render(\WP_Post $post): void {
        wp_nonce_field('sbs_guidance_save', 'sbs_guidance_nonce');
        $val  = (int) get_post_meta($post->ID, '_sbs_value_rating',      true);
        $dur  = (int) get_post_meta($post->ID, '_sbs_durability_rating',  true);
        $tech = (int) get_post_meta($post->ID, '_sbs_technical_rating',   true);
        $bf   = get_post_meta($post->ID, '_sbs_best_for',       true);
        $nif  = get_post_meta($post->ID, '_sbs_not_ideal_for',  true);
        $badges_raw = get_post_meta($post->ID, '_sbs_badges_json', true);
        $tags_raw   = get_post_meta($post->ID, '_sbs_tags_json',   true);
        $badges = json_decode($badges_raw ?: '[]', true) ?: [];
        $tags   = json_decode($tags_raw   ?: '[]', true) ?: [];
        ?>
        <style>
            .sbs-guidance-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:16px; }
            .sbs-guidance-rating label { display:block; font-weight:600; margin-bottom:4px; }
            .sbs-star-row { display:flex; gap:4px; }
            .sbs-star-row input { display:none; }
            .sbs-star-row label { font-size:24px; cursor:pointer; color:#ddd; }
            .sbs-star-row input:checked ~ label,
            .sbs-star-row label:hover,
            .sbs-star-row label:hover ~ label { color:#f59e0b; }
            .sbs-check-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; }
            .sbs-section-title { font-weight:700; margin:16px 0 8px; border-bottom:1px solid #ddd; padding-bottom:4px; }
        </style>

        <div class="sbs-section-title">Star Ratings (1–5)</div>
        <div class="sbs-guidance-grid">
            <?php foreach ([
                ['_sbs_value_rating',      'value',  'Value for Money',    $val],
                ['_sbs_durability_rating',  'dur',    'Durability',         $dur],
                ['_sbs_technical_rating',   'tech',   'Technical Features', $tech],
            ] as [$meta, $id, $label, $current]): ?>
            <div class="sbs-guidance-rating">
                <label><?= esc_html($label) ?></label>
                <div class="sbs-star-row" style="flex-direction:row-reverse;justify-content:flex-end">
                    <?php for ($i = 5; $i >= 1; $i--): ?>
                    <input type="radio" id="<?= esc_attr($id) ?>_<?= $i ?>"
                           name="<?= esc_attr($meta) ?>" value="<?= $i ?>"
                           <?php checked($current, $i) ?>>
                    <label for="<?= esc_attr($id) ?>_<?= $i ?>" title="<?= $i ?> star">★</label>
                    <?php endfor; ?>
                    <input type="radio" name="<?= esc_attr($meta) ?>" value="0" <?php checked($current, 0) ?> style="display:none">
                </div>
                <small style="color:#888">Current: <?= $current ?: 'Not set' ?></small>
            </div>
            <?php endforeach; ?>
        </div>

        <div class="sbs-section-title">Badges</div>
        <div class="sbs-check-grid">
            <?php foreach (self::BADGES as $badge): ?>
            <label>
                <input type="checkbox" name="sbs_badges[]"
                       value="<?= esc_attr($badge) ?>"
                       <?php checked(in_array($badge, $badges)) ?>>
                <?= esc_html($badge) ?>
            </label>
            <?php endforeach; ?>
        </div>

        <div class="sbs-section-title">Tags</div>
        <div class="sbs-check-grid">
            <?php foreach (self::TAGS as $tag): ?>
            <label>
                <input type="checkbox" name="sbs_tags[]"
                       value="<?= esc_attr($tag) ?>"
                       <?php checked(in_array($tag, $tags)) ?>>
                <?= esc_html($tag) ?>
            </label>
            <?php endforeach; ?>
        </div>

        <div class="sbs-section-title">Suitability</div>
        <table style="width:100%;border-collapse:collapse">
            <tr>
                <td style="width:50%;padding-right:8px">
                    <label style="font-weight:600;color:#15803d">✅ Best For</label><br>
                    <small style="color:#888">One item per line</small>
                    <textarea name="_sbs_best_for" rows="5" style="width:100%;margin-top:4px"><?= esc_textarea($bf) ?></textarea>
                </td>
                <td style="padding-left:8px">
                    <label style="font-weight:600;color:#c2410c">⚠️ Not Ideal For</label><br>
                    <small style="color:#888">One item per line</small>
                    <textarea name="_sbs_not_ideal_for" rows="5" style="width:100%;margin-top:4px"><?= esc_textarea($nif) ?></textarea>
                </td>
            </tr>
        </table>
        <?php
    }

    public function save(int $post_id): void {
        if (!isset($_POST['sbs_guidance_nonce']) ||
            !wp_verify_nonce($_POST['sbs_guidance_nonce'], 'sbs_guidance_save')) return;
        if (!current_user_can('edit_post', $post_id)) return;

        foreach (['_sbs_value_rating', '_sbs_durability_rating', '_sbs_technical_rating'] as $key) {
            $v = isset($_POST[$key]) ? max(0, min(5, (int) $_POST[$key])) : 0;
            update_post_meta($post_id, $key, $v);
            // Also save star string for convenience
            update_post_meta($post_id, $key . '_stars', str_repeat('★', $v) . str_repeat('☆', 5 - $v));
        }

        $badges = array_intersect($_POST['sbs_badges'] ?? [], self::BADGES);
        update_post_meta($post_id, '_sbs_badges',      implode(',', $badges));
        update_post_meta($post_id, '_sbs_badges_json', wp_json_encode(array_values($badges)));

        $tags = array_intersect($_POST['sbs_tags'] ?? [], self::TAGS);
        update_post_meta($post_id, '_sbs_tags',      implode(',', $tags));
        update_post_meta($post_id, '_sbs_tags_json', wp_json_encode(array_values($tags)));

        update_post_meta($post_id, '_sbs_best_for',      sanitize_textarea_field($_POST['_sbs_best_for']      ?? ''));
        update_post_meta($post_id, '_sbs_not_ideal_for', sanitize_textarea_field($_POST['_sbs_not_ideal_for'] ?? ''));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// DISPLAY — Product page panel
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Guidance_Display {

    const BADGE_STYLES = [
        'Most Popular'      => ['icon' => '🏆', 'bg' => '#1e3a5f', 'color' => '#fff'],
        'Best Value'        => ['icon' => '💰', 'bg' => '#15803d', 'color' => '#fff'],
        'Premium Choice'    => ['icon' => '💎', 'bg' => '#6d28d9', 'color' => '#fff'],
        'New Arrival'       => ['icon' => '🆕', 'bg' => '#0369a1', 'color' => '#fff'],
        'Best Seller'       => ['icon' => '⭐', 'bg' => '#b45309', 'color' => '#fff'],
        'Eco Friendly'      => ['icon' => '🌿', 'bg' => '#166534', 'color' => '#fff'],
        'Award Winner'      => ['icon' => '🏅', 'bg' => '#92400e', 'color' => '#fff'],
        'Exclusive'         => ['icon' => '✨', 'bg' => '#831843', 'color' => '#fff'],
        'Sale'              => ['icon' => '🏷️','bg' => '#991b1b', 'color' => '#fff'],
        'Staff Pick'        => ['icon' => '⭐', 'bg' => '#92400e', 'color' => '#fff'],
        'Bulk Buy Discount' => ['icon' => '📦', 'bg' => '#075985', 'color' => '#fff'],
    ];

    const TAG_STYLES = [
        'Everyday Workwear' => ['icon' => '👕', 'color' => '#1d4ed8', 'border' => '#3b82f6'],
        'Smart Uniform'     => ['icon' => '👔', 'color' => '#7e22ce', 'border' => '#a855f7'],
        'Heavy Duty'        => ['icon' => '💪', 'color' => '#c2410c', 'border' => '#f97316'],
        'Budget Friendly'   => ['icon' => '💲', 'color' => '#15803d', 'border' => '#22c55e'],
        'Premium'           => ['icon' => '💎', 'color' => '#6d28d9', 'border' => '#8b5cf6'],
    ];

    public function __construct() {
        add_action('woocommerce_single_product_summary', [$this, 'render'], 25);
        add_action('wp_head', [$this, 'styles']);
    }

    public function styles(): void {
        if (!is_product()) return;
        echo '<style>
        .sbs-guidance-wrap{margin:20px 0}
        .sbs-ratings-panel{display:flex;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#1e3a5f,#2d5491);border-radius:10px;margin-bottom:14px}
        .sbs-rating-item{flex:1;min-width:100px;text-align:center}
        .sbs-rating-label{font-size:.65em;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
        .sbs-rating-stars{color:#fbbf24;font-size:1.4em;letter-spacing:2px}
        .sbs-rating-num{font-size:.7em;color:#bfdbfe;margin-top:2px}
        .sbs-badges{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
        .sbs-badge{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:999px;font-size:.82em;font-weight:700;white-space:nowrap}
        .sbs-tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
        .sbs-tag{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:999px;font-size:.8em;font-weight:600;border-width:2px;border-style:solid;background:#fff}
        .sbs-panel{border-radius:8px;overflow:hidden;margin-bottom:12px}
        .sbs-panel-header{padding:8px 14px;font-weight:700;font-size:.88em;display:flex;align-items:center;gap:6px}
        .sbs-panel-body{padding:10px 14px;background:#fff}
        .sbs-panel-body ul{margin:0;padding-left:18px;color:#374151;font-size:.9em;line-height:1.7}
        .sbs-best-for .sbs-panel-header{background:#15803d;color:#fff}
        .sbs-best-for{border:1.5px solid #d1fae5}
        .sbs-not-ideal .sbs-panel-header{background:#c2410c;color:#fff}
        .sbs-not-ideal{border:1.5px solid #fed7aa}
        </style>';
    }

    public function render(): void {
        global $product;
        if (!$product) return;
        $id = $product->get_id();

        $val  = (int) get_post_meta($id, '_sbs_value_rating',      true);
        $dur  = (int) get_post_meta($id, '_sbs_durability_rating',  true);
        $tech = (int) get_post_meta($id, '_sbs_technical_rating',   true);
        $bf   = get_post_meta($id, '_sbs_best_for',       true);
        $nif  = get_post_meta($id, '_sbs_not_ideal_for',  true);
        $badges = json_decode(get_post_meta($id, '_sbs_badges_json', true) ?: '[]', true) ?: [];
        $tags   = json_decode(get_post_meta($id, '_sbs_tags_json',   true) ?: '[]', true) ?: [];

        $has_ratings = $val > 0 || $dur > 0 || $tech > 0;
        if (!$has_ratings && empty($badges) && empty($tags) && !$bf && !$nif) return;

        echo '<div class="sbs-guidance-wrap">';

        // Star ratings
        if ($has_ratings) {
            echo '<div class="sbs-ratings-panel">';
            foreach ([
                [$val,  'Value for Money'],
                [$dur,  'Durability'],
                [$tech, 'Technical Features'],
            ] as [$n, $label]) {
                if ($n <= 0) continue;
                echo '<div class="sbs-rating-item">';
                echo '<div class="sbs-rating-label">' . esc_html($label) . '</div>';
                echo '<div class="sbs-rating-stars">' . str_repeat('★', $n) . str_repeat('☆', 5 - $n) . '</div>';
                echo '<div class="sbs-rating-num">' . $n . ' / 5</div>';
                echo '</div>';
            }
            echo '</div>';
        }

        // Badges
        if (!empty($badges)) {
            echo '<div class="sbs-badges">';
            foreach ($badges as $b) {
                $s = self::BADGE_STYLES[$b] ?? ['icon' => '✔', 'bg' => '#1e3a5f', 'color' => '#fff'];
                printf(
                    '<span class="sbs-badge" style="background:%s;color:%s">%s %s</span>',
                    esc_attr($s['bg']), esc_attr($s['color']),
                    esc_html($s['icon']), esc_html($b)
                );
            }
            echo '</div>';
        }

        // Tags
        if (!empty($tags)) {
            echo '<div class="sbs-tags">';
            foreach ($tags as $t) {
                $s = self::TAG_STYLES[$t] ?? ['icon' => '🏷', 'color' => '#334155', 'border' => '#94a3b8'];
                printf(
                    '<span class="sbs-tag" style="color:%s;border-color:%s">%s %s</span>',
                    esc_attr($s['color']), esc_attr($s['border']),
                    esc_html($s['icon']), esc_html($t)
                );
            }
            echo '</div>';
        }

        // Best For
        if ($bf) {
            $lines = array_filter(explode("\n", $bf));
            echo '<div class="sbs-panel sbs-best-for"><div class="sbs-panel-header">✅ Best For</div><div class="sbs-panel-body"><ul>';
            foreach ($lines as $l) echo '<li>' . esc_html(trim($l)) . '</li>';
            echo '</ul></div></div>';
        }

        // Not Ideal For
        if ($nif) {
            $lines = array_filter(explode("\n", $nif));
            echo '<div class="sbs-panel sbs-not-ideal"><div class="sbs-panel-header">⚠️ Not Ideal For</div><div class="sbs-panel-body"><ul>';
            foreach ($lines as $l) echo '<li>' . esc_html(trim($l)) . '</li>';
            echo '</ul></div></div>';
        }

        echo '</div>';
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK — CSV import / export under Products > Guidance Bulk Edit
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Guidance_Bulk {

    public function __construct() {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_init', [$this, 'handle_actions']);
    }

    public function menu(): void {
        add_submenu_page(
            'edit.php?post_type=product',
            'Guidance Bulk Edit',
            'Guidance Bulk Edit',
            'manage_woocommerce',
            'sbs-guidance-bulk',
            [$this, 'page']
        );
    }

    public function handle_actions(): void {
        if (!current_user_can('manage_woocommerce')) return;

        // ── Export ──────────────────────────────────────────────────────────
        if (isset($_GET['sbs_export_guidance']) && check_admin_referer('sbs_export_guidance')) {
            $this->do_export();
            exit;
        }

        // ── Import ──────────────────────────────────────────────────────────
        if (isset($_POST['sbs_import_guidance']) && check_admin_referer('sbs_import_guidance')) {
            $this->do_import();
        }
    }

    private function do_export(): void {
        $products = wc_get_products(['limit' => -1, 'status' => 'publish']);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="sbs-guidance-export-' . date('Y-m-d') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['ID', 'SKU', 'Name', 'value_rating', 'durability_rating', 'technical_rating', 'badges', 'tags', 'best_for', 'not_ideal_for']);
        foreach ($products as $p) {
            fputcsv($out, [
                $p->get_id(),
                $p->get_sku(),
                $p->get_name(),
                get_post_meta($p->get_id(), '_sbs_value_rating',      true) ?: '',
                get_post_meta($p->get_id(), '_sbs_durability_rating',  true) ?: '',
                get_post_meta($p->get_id(), '_sbs_technical_rating',   true) ?: '',
                get_post_meta($p->get_id(), '_sbs_badges',             true) ?: '',
                get_post_meta($p->get_id(), '_sbs_tags',               true) ?: '',
                get_post_meta($p->get_id(), '_sbs_best_for',           true) ?: '',
                get_post_meta($p->get_id(), '_sbs_not_ideal_for',      true) ?: '',
            ]);
        }
        fclose($out);
    }

    private function do_import(): void {
        if (empty($_FILES['sbs_csv']['tmp_name'])) {
            add_settings_error('sbs_guidance', 'no_file', 'No file uploaded.', 'error');
            return;
        }
        $handle = fopen($_FILES['sbs_csv']['tmp_name'], 'r');
        $header = fgetcsv($handle); // skip header row
        $updated = 0;
        while (($row = fgetcsv($handle)) !== false) {
            if (count($row) < 10) continue;
            [$id, , , $val, $dur, $tech, $badges_str, $tags_str, $bf, $nif] = $row;
            $id = (int) $id;
            if (!$id || !get_post($id)) continue;

            update_post_meta($id, '_sbs_value_rating',      max(0, min(5, (int)$val)));
            update_post_meta($id, '_sbs_durability_rating',  max(0, min(5, (int)$dur)));
            update_post_meta($id, '_sbs_technical_rating',   max(0, min(5, (int)$tech)));

            $badges = array_filter(array_map('trim', explode(',', $badges_str)));
            update_post_meta($id, '_sbs_badges',      $badges_str);
            update_post_meta($id, '_sbs_badges_json', wp_json_encode(array_values($badges)));

            $tags = array_filter(array_map('trim', explode(',', $tags_str)));
            update_post_meta($id, '_sbs_tags',      $tags_str);
            update_post_meta($id, '_sbs_tags_json', wp_json_encode(array_values($tags)));

            update_post_meta($id, '_sbs_best_for',      sanitize_textarea_field($bf));
            update_post_meta($id, '_sbs_not_ideal_for', sanitize_textarea_field($nif));
            $updated++;
        }
        fclose($handle);
        add_settings_error('sbs_guidance', 'import_done',
            sprintf('Import complete — %d product(s) updated.', $updated), 'success');
    }

    public function page(): void {
        settings_errors('sbs_guidance');
        $export_url = wp_nonce_url(
            admin_url('edit.php?post_type=product&page=sbs-guidance-bulk&sbs_export_guidance=1'),
            'sbs_export_guidance'
        );
        ?>
        <div class="wrap">
            <h1>SBS Guidance Bulk Edit</h1>
            <p>Export a CSV to edit guidance data in a spreadsheet, then import it back.</p>

            <h2>Export</h2>
            <p><a href="<?= esc_url($export_url) ?>" class="button button-primary">⬇ Download CSV</a></p>
            <p><em>Columns: ID, SKU, Name, value_rating (0–5), durability_rating (0–5), technical_rating (0–5), badges (comma-separated), tags (comma-separated), best_for (line-separated), not_ideal_for (line-separated)</em></p>

            <h2 style="margin-top:32px">Import</h2>
            <form method="post" enctype="multipart/form-data">
                <?php wp_nonce_field('sbs_import_guidance') ?>
                <input type="file" name="sbs_csv" accept=".csv" required>
                <input type="submit" name="sbs_import_guidance" class="button button-primary" value="⬆ Import CSV" style="margin-left:8px">
            </form>
        </div>
        <?php
    }
}
