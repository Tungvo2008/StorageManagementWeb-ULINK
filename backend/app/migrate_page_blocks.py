from sqlalchemy import select

from app.db.models import WebsitePageBlock
from app.db.session import SessionLocal

ROWS = [
    ("ulink", "vi", "hero", "ULINK • KẾT NỐI KHÔNG GIỚI HẠN", "Kết nối hàng hóa.\nMở rộng cơ hội.", "Đồng hành cùng doanh nghiệp trong hành trình tìm nguồn hàng, vận chuyển và phát triển thương mại giữa các thị trường.", "https://ulink-llc.com/media/hero.webp", "ULINK logistics and trade", "Khám phá dịch vụ"),
    ("ulink", "en", "hero", "ULINK • CONNECTIONS WITHOUT BORDERS", "Connect goods.\nExpand opportunity.", "Supporting businesses with sourcing, logistics, and trade connections across markets.", "https://ulink-llc.com/media/hero.webp", "ULINK logistics and trade", "Explore services"),
    ("ulink", "vi", "intro", "VỀ ULINK", "Một đối tác cho hành trình thương mại của bạn", "ULINK kết nối nhu cầu kinh doanh với giải pháp cung ứng và logistics phù hợp. Chúng tôi hướng tới quy trình rõ ràng, trao đổi trực tiếp và mối quan hệ bền vững với từng đối tác.", "https://ulink-llc.com/media/about-v2.webp", "Hợp tác trong cung ứng và logistics", "Tìm hiểu thêm"),
    ("ulink", "en", "intro", "ABOUT ULINK", "One partner for your trade journey", "ULINK connects business needs with practical sourcing and logistics solutions. We focus on clear processes, direct communication, and lasting partnerships.", "https://ulink-llc.com/media/about-v2.webp", "Business sourcing and logistics partnership", "Learn more"),
    ("ulink", "vi", "wholesale", "ULINK WHOLESALE", "Hàng hóa kết nối trực tiếp với dữ liệu kho", "Khám phá danh mục wholesale và trạng thái sẵn hàng được cập nhật từ hệ thống quản lý hàng hóa của ULINK. Liên hệ để xác nhận báo giá và đơn hàng.", None, None, "Xem danh mục"),
    ("ulink", "en", "wholesale", "ULINK WHOLESALE", "Products connected to live inventory", "Explore our wholesale catalog and availability from ULINK’s inventory system. Contact us to confirm pricing and orders.", None, None, "View catalog"),
    ("ulink", "vi", "final", "LET'S CONNECT", "Bắt đầu cuộc trò chuyện với ULINK", "Chia sẻ kế hoạch của bạn, chúng tôi sẽ cùng tìm hướng triển khai phù hợp.", None, None, "Liên hệ tư vấn"),
    ("ulink", "en", "final", "LET'S CONNECT", "Start a conversation with ULINK", "Tell us about your plans and we will explore a practical way forward.", None, None, "Get in touch"),
    ("towels", "en", "hero", "THE TOWELS HAVEN · HOME & NAIL SALON", "Everyday towels, made to feel good.", "Three practical styles for bathrooms, daily routines, and busy nail stations. Find your size, choose your color, and make it yours.", "https://thetowelshaven.com/media/hero-v2.webp", "Towels for home and nail salons", "EXPLORE THE TOWELS"),
    ("towels", "en", "collection", "START HERE", "Find the towel that fits your day.", "One focused collection. Choose the size and feel that makes sense for your space.", None, None, "SHOP ALL COLORS"),
    ("towels", "en", "colors", "MAKE IT YOURS", "Pick a color that belongs in your space.", "Start with the towel style, then explore the available shades in the live collection.", "https://thetowelshaven.com/media/colors-v2.webp", "Plain terry towels in white, sage green, and navy", "SEE ALL COLORS"),
    ("towels", "en", "final", "YOUR EVERYDAY, A LITTLE SOFTER", "Find your next favorite towel.", "Shop the three styles and choose the color that feels right for home or work.", None, None, "EXPLORE THE COLLECTION"),
]

def main() -> None:
    added = 0
    with SessionLocal() as db:
        for site, locale, block_key, eyebrow, title, body, image_url, image_alt, cta_label in ROWS:
            if db.scalar(select(WebsitePageBlock).where(
                WebsitePageBlock.site == site,
                WebsitePageBlock.page == "home",
                WebsitePageBlock.block_key == block_key,
                WebsitePageBlock.locale == locale,
            )):
                continue
            db.add(WebsitePageBlock(
                site=site, page="home", block_key=block_key, locale=locale,
                eyebrow=eyebrow, title=title, body=body,
                image_url=image_url, image_alt=image_alt, cta_label=cta_label,
                is_published=True,
            ))
            added += 1
        db.commit()
    print({"page_blocks_added": added})


if __name__ == "__main__":
    main()
