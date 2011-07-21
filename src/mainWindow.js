/*
 * Copyright (c) 2011 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const EvView = imports.gi.EvinceView;
const Gd = imports.gi.Gd;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;

const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Main = imports.main;
const MainToolbar = imports.mainToolbar;
const Sidebar = imports.sidebar;
const TrackerModel = imports.trackerModel;
const IconView = imports.iconView;
const ListView = imports.listView;
const Preview = imports.preview;
const SpinnerBox = imports.spinnerBox;

const _ = imports.gettext.gettext;

const _WINDOW_DEFAULT_WIDTH = 768;
const _WINDOW_DEFAULT_HEIGHT = 600;

const _SEARCH_ENTRY_TIMEOUT = 200;
const _PDF_LOADER_TIMEOUT = 300;

function MainWindow() {
    this._init();
}

MainWindow.prototype = {
    _init: function() {
        this._searchTimeout = 0;
        this._loaderTimeout = 0;

        this.window = new Gtk.Window({ type: Gtk.WindowType.TOPLEVEL,
                                       window_position: Gtk.WindowPosition.CENTER,
                                       title: _('Documents') });

        this.window.set_size_request(_WINDOW_DEFAULT_WIDTH, _WINDOW_DEFAULT_HEIGHT);
        this.window.maximize();
        this.window.connect('delete-event',
                            Lang.bind(this, this._onDeleteEvent));

        Main.settings.connect('changed::list-view', Lang.bind(this, function() {
            this._refreshViewSettings(true);
        }));

        this._grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL });
        this.window.add(this._grid);

        this._searchTimeout = 0;
        this._toolbar = new MainToolbar.MainToolbar();
        this._toolbar.setOverview();
        this._toolbar.searchEntry.connect('changed',
                                          Lang.bind(this, this._onSearchEntryChanged));
        this._toolbar.connect('back-clicked',
                              Lang.bind(this, this._onToolbarBackClicked));

        this._grid.add(this._toolbar.widget);

        this._viewContainer = new Gtk.Grid({ orientation: Gtk.Orientation.HORIZONTAL });
        this._grid.add(this._viewContainer);

        this._sidebar = new Sidebar.Sidebar();
        this._sidebar.connect('source-filter-changed', Lang.bind(this, this._onSourceFilterChanged));
        this._viewContainer.add(this._sidebar.widget);

        this._scrolledWin = new Gtk.ScrolledWindow({ hexpand: true,
                                                     vexpand: true});
        this._viewContainer.add(this._scrolledWin);

        this._initView();
        this._grid.show_all();

        this._model = new TrackerModel.TrackerModel(Lang.bind(this, this._onModelCreated));
        this._model.connect('count-updated', Lang.bind(this, this._onModelCountUpdated));
    },

    _destroyView: function() {
        let child = this._scrolledWin.get_child();
        if (child)
            child.destroy();
    },

    _initView: function() {
        let isList = Main.settings.get_boolean('list-view');

        this._destroyView();

        this._loadMore = new Gtk.Button();
        this._loadMore.connect('clicked', Lang.bind(this, function() {
            this._model.loadMore();
        }));

        this._viewBox = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL });
        this._viewBox.add(this._loadMore);

        if (isList)
            this.view = new ListView.ListView(this);
        else
            this.view = new IconView.IconView(this);

        this.view.connect('item-activated', Lang.bind(this, this._onViewItemActivated));

        this._viewBox.attach_next_to(this.view.widget, this._loadMore,
                                     Gtk.PositionType.TOP, 1, 1);

        this._scrolledWin.add_with_viewport(this._viewBox);

        this._viewBox.show();
    },

    _refreshViewSettings: function() {
        this._initView();
        this.view.setModel(this._model.model);
    },

    _refreshLoadMoreButton: function(itemCount, offset) {
        let remainingDocs = itemCount - (offset + TrackerModel.OFFSET_STEP);

        if (remainingDocs <= 0) {
            this._loadMore.hide();
            return;
        }

        if (remainingDocs > TrackerModel.OFFSET_STEP)
            remainingDocs = TrackerModel.OFFSET_STEP;

        this._loadMore.label = _('Load %d more documents').format(remainingDocs);
        this._loadMore.show();
    },

    _prepareForPreview: function(model, document) {
        this._destroyView();
        this._sidebar.widget.hide();

        this._toolbar.setPreview(model, document);
    },

    _onModelCreated: function() {
        this.view.setModel(this._model.model);
        this._model.populateForOverview();
    },

    _onDeleteEvent: function() {
        Main.application.quit();
    },

    _onViewItemActivated: function(view, uri) {
        let loader = new Gd.PdfLoader();
        loader.connect('notify::document', Lang.bind(this, this._onDocumentLoaded));
        loader.uri = uri;

        this._loaderTimeout = Mainloop.timeout_add(_PDF_LOADER_TIMEOUT,
                                                   Lang.bind(this, this._onPdfLoaderTimeout));
    },

    _onPdfLoaderTimeout: function() {
        this._loaderTimeout = 0;

        this._prepareForPreview();

        let spinnerBox = new SpinnerBox.SpinnerBox();
        this._scrolledWin.add_with_viewport(spinnerBox.widget);

        return false;
    },

    _onDocumentLoaded: function(loader) {
        let document = loader.document;
        let model = EvView.DocumentModel.new_with_document(document);

        if (this._loaderTimeout) {
            Mainloop.source_remove(this._loaderTimeout);
            this._loaderTimeout = 0;
        }

        this._prepareForPreview(model, document);
        this._preview = new Preview.PreviewView(model, document);

        this._scrolledWin.add(this._preview.widget);
    },

    _onToolbarBackClicked: function() {
        if (this._preview)
            this._preview.destroy();

        this._sidebar.widget.show();
        this._toolbar.setOverview();

        this._refreshViewSettings();
        // needs to be called after _refreshViewSettings(), as that
        // recreates the button
        this._refreshLoadMoreButton(this._model.itemCount, this._model.offset);
    },

    _onSearchEntryChanged: function() {
        if (this._searchTimeout != 0) {
            GLib.source_remove(this._searchTimeout);
            this._searchTimeout = 0;
        }

        this._searchTimeout = Mainloop.timeout_add(_SEARCH_ENTRY_TIMEOUT,
                                                   Lang.bind(this, this._onSearchEntryTimeout));
    },

    _onSearchEntryTimeout: function() {
        this._searchTimeout = 0;

        let text = this._toolbar.searchEntry.get_text();
        this._model.setFilter(text);
    },

    _onModelCountUpdated: function(model, itemCount, offset) {
        this._refreshLoadMoreButton(itemCount, offset);
    },

    _onSourceFilterChanged: function(sidebar, id) {
        this._model.setAccountFilter(id);
    }
}
