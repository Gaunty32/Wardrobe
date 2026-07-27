<?php
/**
 * Plugin Name: SBS Quantity Discount
 * Plugin URI:  https://selectbranding.co.uk
 * Description: Adds quantity-based pricing tiers to WooCommerce products. Shows a pricing table on the product page and applies the correct unit price in the cart.
 * Version:     1.0.0
 * Author:      Select Branding Solutions
 * Text Domain: sbs-qty-discount
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * WC requires at least: 8.0
 */

defined('ABSPATH') || exit;

add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) return;
    new SBS_Quantity_Discount_Admin();
    new SBS_Quantity_Discount_Display();
    new SBS_Quantity_Discount_Cart();
});

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════
function sbs_qty_get_tiers(int $product_id): array {
    $raw = get_post_meta($product_id, '_sbs_qty_tiers', true);
    if (!$raw) return [];
    $tiers = json_decode($raw, true);
    return is_array($tiers) ? $tiers : [];
}

function sbs_qty_price_for(int $qty, array $tiers): ?float {
    if (empty($tiers)) return null;
    // Sort descending by min_qty so we match the highest applicable tier
    usort($tiers, fn($a, $b) => $b['min_qty'] - $a['min_qty']);
    foreach ($tiers as $tier) {
        if ($qty >= (int) $tier['min_qty']) {
            return (float) $tier['price'];
        }
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Meta box
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Quantity_Discount_Admin {

    public function __construct() {
        add_action('add_meta_boxes', [$this, 'register']);
        add_action('woocommerce_process_product_meta', [$this, 'save']);
    }

    public function register(): void {
        add_meta_box('sbs_qty_discount', '📦 SBS Quantity Discount Tiers',
            [$this, 'render'], 'product', 'normal', 'default');
    }

    public function render(\WP_Post $post): void {
        wp_nonce_field('sbs_qty_save', 'sbs_qty_nonce');
        $tiers = sbs_qty_get_tiers($post->ID);
        if (empty($tiers)) {
            $tiers = [
                ['min_qty' => 1,  'max_qty' => 11,  'price' => '', 'label' => ''],
                ['min_qty' => 12, 'max_qty' => 23,  'price' => '', 'label' => ''],
                ['min_qty' => 24, 'max_qty' => '',   'price' => '', 'label' => ''],
            ];
        }
        ?>
        <style>
            .sbs-tiers-table { width:100%; border-collapse:collapse; }
            .sbs-tiers-table th { background:#f5f5f5; padding:8px; text-align:left; font-size:13px; }
            .sbs-tiers-table td { padding:6px 8px; border-bottom:1px solid #eee; }
            .sbs-tiers-table input[type=number],
            .sbs-tiers-table input[type=text] { width:100%; }
        </style>
        <p style="color:#666;font-size:13px">Set tiered pricing. Leave rows blank to disable. The lowest applicable tier's price is used in the cart. Set <strong>Max Qty</strong> blank for open-ended (e.g. "24+").</p>
        <table class="sbs-tiers-table" id="sbs-tiers">
            <thead>
                <tr>
                    <th>Min Qty</th><th>Max Qty</th><th>Unit Price (£ ex VAT)</th><th>Label (optional)</th><th></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($tiers as $i => $t): ?>
                <tr>
                    <td><input type="number" name="sbs_tiers[<?= $i ?>][min_qty]" value="<?= esc_attr($t['min_qty'] ?? '') ?>" min="1" step="1"></td>
                    <td><input type="number" name="sbs_tiers[<?= $i ?>][max_qty]" value="<?= esc_attr($t['max_qty'] ?? '') ?>" min="1" step="1" placeholder="∞"></td>
                    <td><input type="number" name="sbs_tiers[<?= $i ?>][price]"   value="<?= esc_attr($t['price']   ?? '') ?>" min="0" step="0.01" placeholder="e.g. 9.50"></td>
                    <td><input type="text"   name="sbs_tiers[<?= $i ?>][label]"   value="<?= esc_attr($t['label']   ?? '') ?>" placeholder="e.g. Team order"></td>
                    <td><button type="button" onclick="this.closest('tr').remove()" style="color:red;background:none;border:none;cursor:pointer">✕</button></td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
        <p>
            <button type="button" id="sbs-add-tier" class="button">+ Add Tier</button>
        </p>
        <script>
        document.getElementById('sbs-add-tier').addEventListener('click', function(){
            const tbody = document.querySelector('#sbs-tiers tbody');
            const idx   = tbody.rows.length;
            const tr    = document.createElement('tr');
            tr.innerHTML = `<td><input type="number" name="sbs_tiers[${idx}][min_qty]" min="1" step="1"></td>
                <td><input type="number" name="sbs_tiers[${idx}][max_qty]" min="1" step="1" placeholder="∞"></td>
                <td><input type="number" name="sbs_tiers[${idx}][price]" min="0" step="0.01" placeholder="e.g. 9.50"></td>
                <td><input type="text" name="sbs_tiers[${idx}][label]" placeholder="e.g. Team order"></td>
                <td><button type="button" onclick="this.closest('tr').remove()" style="color:red;background:none;border:none;cursor:pointer">✕</button></td>`;
            tbody.appendChild(tr);
        });
        </script>
        <?php
    }

    public function save(int $post_id): void {
        if (!isset($_POST['sbs_qty_nonce']) || !wp_verify_nonce($_POST['sbs_qty_nonce'], 'sbs_qty_save')) return;
        if (!current_user_can('edit_post', $post_id)) return;

        $raw   = $_POST['sbs_tiers'] ?? [];
        $tiers = [];
        foreach ($raw as $tier) {
            $min   = (int)   ($tier['min_qty'] ?? 0);
            $price = (float) ($tier['price']   ?? 0);
            if ($min < 1 || $price <= 0) continue;
            $tiers[] = [
                'min_qty' => $min,
                'max_qty' => isset($tier['max_qty']) && $tier['max_qty'] !== '' ? (int)$tier['max_qty'] : null,
                'price'   => $price,
                'label'   => sanitize_text_field($tier['label'] ?? ''),
            ];
        }
        usort($tiers, fn($a, $b) => $a['min_qty'] - $b['min_qty']);
        update_post_meta($post_id, '_sbs_qty_tiers', wp_json_encode($tiers));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// DISPLAY — Pricing table on product page
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Quantity_Discount_Display {

    public function __construct() {
        add_action('woocommerce_single_product_summary', [$this, 'render'], 22);
        add_action('wp_head', [$this, 'styles']);
    }

    public function styles(): void {
        if (!is_product()) return;
        echo '<style>
        .sbs-qty-table-wrap{margin:16px 0}
        .sbs-qty-table-wrap h4{font-size:.85em;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:8px}
        .sbs-qty-table{width:100%;border-collapse:collapse;font-size:.9em}
        .sbs-qty-table th{background:#1e3a5f;color:#fff;padding:8px 12px;text-align:left}
        .sbs-qty-table td{padding:8px 12px;border-bottom:1px solid #e5e7eb}
        .sbs-qty-table tr:last-child td{border-bottom:none}
        .sbs-qty-table tr.sbs-qty-active td{background:#eff6ff;font-weight:700;color:#1d4ed8}
        .sbs-qty-save{color:#15803d;font-size:.8em;margin-left:8px}
        </style>';
    }

    public function render(): void {
        global $product;
        if (!$product) return;
        $tiers = sbs_qty_get_tiers($product->get_id());
        if (empty($tiers)) return;

        $base_price = (float) $product->get_price();
        echo '<div class="sbs-qty-table-wrap">';
        echo '<h4>Quantity Pricing</h4>';
        echo '<table class="sbs-qty-table">';
        echo '<thead><tr><th>Quantity</th><th>Unit Price (Ex. VAT)</th><th>Save</th></tr></thead><tbody>';

        foreach ($tiers as $t) {
            $min  = (int) $t['min_qty'];
            $max  = $t['max_qty'] ? (int)$t['max_qty'] : null;
            $price = (float) $t['price'];
            $qty_label = $max ? "{$min}–{$max}" : "{$min}+";
            $saving = $base_price > $price ? round((($base_price - $price) / $base_price) * 100) : 0;
            $save_str = $saving > 0 ? "<span class='sbs-qty-save'>Save {$saving}%</span>" : '';
            printf('<tr><td>%s</td><td>£%.2f %s</td><td>%s</td></tr>',
                esc_html($qty_label), $price,
                $t['label'] ? '<small>(' . esc_html($t['label']) . ')</small>' : '',
                $save_str
            );
        }
        echo '</tbody></table></div>';
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CART — Apply tiered price when quantity changes
// ══════════════════════════════════════════════════════════════════════════════
class SBS_Quantity_Discount_Cart {

    public function __construct() {
        add_action('woocommerce_before_calculate_totals', [$this, 'apply'], 10, 1);
    }

    public function apply(\WC_Cart $cart): void {
        if (is_admin() && !defined('DOING_AJAX')) return;
        if (did_action('woocommerce_before_calculate_totals') >= 2) return;

        foreach ($cart->get_cart() as $item) {
            $product_id = $item['product_id'];
            $qty        = (int) $item['quantity'];
            $tiers      = sbs_qty_get_tiers($product_id);
            if (empty($tiers)) continue;

            $tier_price = sbs_qty_price_for($qty, $tiers);
            if ($tier_price !== null) {
                $item['data']->set_price($tier_price);
            }
        }
    }
}
