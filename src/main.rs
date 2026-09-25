use relm4::gtk::prelude::*;
use relm4::prelude::*;
use relm4::{adw, gtk};

const APP_ID: &str = "io.github.syharipf.Loom";

struct App;

#[relm4::component]
impl SimpleComponent for App {
    type Init = ();
    type Input = ();
    type Output = ();

    view! {
        adw::ApplicationWindow {
            set_title: Some("Loom"),
            set_default_size: (960, 640),

            gtk::Box {
                set_orientation: gtk::Orientation::Vertical,

                adw::HeaderBar {},

                adw::StatusPage {
                    set_vexpand: true,
                    set_title: "Loom",
                },
            },
        }
    }

    fn init(_: (), root: Self::Root, _sender: ComponentSender<Self>) -> ComponentParts<Self> {
        let model = App;
        let widgets = view_output!();
        ComponentParts { model, widgets }
    }
}

fn main() {
    RelmApp::new(APP_ID).run::<App>(());
}
