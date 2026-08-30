import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { uploadImage, extensionForFile, deleteImageByUrl } from '../../services/storageService';
import { ImageUploader } from '../common/ImageUploader';
import { Hotel, FoodItem } from '../../types';
import {
  Utensils,
  Plus,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  DollarSign,
  Trash2,
  X,
  Leaf,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const FoodMenuTab: React.FC<Props> = ({ hotel }) => {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FoodItem | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Main Course');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('18');
  const [isVegetarian, setIsVegetarian] = useState(false);
  const [prepTime, setPrepTime] = useState('15');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Image State: imageUrl = already-uploaded Storage URL saved with the item;
  // imageFile = pending file for NEW items (uploaded after the doc exists)
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = firestoreService.subscribeFoodItems(
      hotel.id,
      (fetchedItems) => {
        setItems(fetchedItems);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching food items:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const categories = Array.from(new Set(items.map((i) => i.category || 'General')));

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleToggleAvailability = async (item: FoodItem) => {
    try {
      await firestoreService.updateFoodItem(hotel.id, item.id, {
        isAvailable: !item.isAvailable,
      });
    } catch (err: any) {
      alert(`Error updating item: ${err.message}`);
    }
  };

  const handleOpenEdit = (item?: FoodItem) => {
    if (item) {
      setEditingItem(item);
      setName(item.name);
      setCategory(item.category || 'Main Course');
      setDescription(item.description || '');
      setPrice((item.basePrice || (item as any).price || 0).toString());
      setIsVegetarian(item.isVegetarian || (item as any).isVeg || false);
      setPrepTime((item.preparationTimeMinutes || item.prepTimeMinutes || 15).toString());
      setImageUrl(item.imageUrl || '');
      setImageFile(null);
    } else {
      setEditingItem(null);
      setName('');
      setCategory('Main Course');
      setDescription('');
      setPrice('18');
      setIsVegetarian(false);
      setPrepTime('15');
      setImageUrl('');
      setImageFile(null);
    }
    setIsEditModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        categoryId: category.toLowerCase().replace(/\s+/g, '_'),
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        basePrice: parseFloat(price) || 0,
        price: parseFloat(price) || 0,
        isVegetarian,
        isVeg: isVegetarian,
        isAvailable: editingItem ? editingItem.isAvailable : true,
        preparationTimeMinutes: parseInt(prepTime, 10) || 15,
        prepTimeMinutes: parseInt(prepTime, 10) || 15,
      };

      if (editingItem) {
        // Existing item — uploader already pushed the file to
        // hotels/{hotelId}/menu/{itemId}/image.jpg; persist the URL (or cleared value)
        await firestoreService.updateFoodItem(hotel.id, editingItem.id, {
          ...payload,
          imageUrl,
        } as any);
      } else {
        // New item — create the doc first, then upload under its ID and save the URL back
        const newItemId = await firestoreService.addFoodItem(hotel.id, payload as any);
        if (imageFile) {
          try {
            const url = await uploadImage({
              file: imageFile,
              path: `hotels/${hotel.id}/menu/${newItemId}/image.${extensionForFile(imageFile)}`,
            });
            await firestoreService.updateFoodItem(hotel.id, newItemId, { imageUrl: url } as any);
          } catch (uploadErr: any) {
            console.warn('Menu image upload failed (item was still created):', uploadErr?.message);
          }
        }
      }
      setIsEditModalOpen(false);
    } catch (err: any) {
      alert(`Error saving item: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (item: FoodItem) => {
    if (window.confirm(`Delete menu item "${item.name}"?`)) {
      try {
        await firestoreService.deleteFoodItem(hotel.id, item.id);
        // Cleanup: remove the uploaded image so Storage stays orphan-free
        await deleteImageByUrl(item.imageUrl);
      } catch (err: any) {
        alert(err.message || 'Failed to delete item');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-hairline p-6 rounded-xl shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center font-bold">
            <Utensils className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Restaurant & F&B Menu</h2>
              <span className="bg-success-tint text-success-deep border border-success-line text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Supabase Synced
              </span>
            </div>
            <p className="text-xs text-ink-mute">
              Manage items, prices, and live in-stock availability for guest in-room dining orders.
            </p>
          </div>
        </div>

        <button
          onClick={() => handleOpenEdit()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> + Add Menu Item
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3.5 rounded-lg border border-hairline">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            type="text"
            placeholder="Search menu items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-canvas-soft border border-hairline rounded-xl pl-9 pr-3.5 py-2 text-xs text-ink focus:outline-none focus:border-ink"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedCategory === 'ALL'
                ? 'bg-ink text-white'
                : 'bg-canvas-soft text-ink-mute hover:bg-hairline'
            }`}
          >
            All Items ({items.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-ink text-white'
                  : 'bg-canvas-soft text-ink-mute hover:bg-hairline'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Items Grid or Empty State */}
      {loading ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#0066cc] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-ink-mute mt-3">Loading menu items…</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center mx-auto">
            <Utensils className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-ink">
              {searchQuery ? 'No matching menu items found' : 'No Menu Items Added Yet'}
            </h3>
            <p className="text-xs text-ink-mute">
              {searchQuery
                ? 'Try searching with another item name.'
                : 'Create your hotel’s dining menu items with prices, categories, and prep times.'}
            </p>
          </div>
          {!searchQuery && (
            <button
              onClick={() => handleOpenEdit()}
              className="px-5 py-2.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add First Menu Item
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const itemPrice = item.basePrice || (item as any).price || 0;
            return (
              <div
                key={item.id}
                className="bg-white border border-hairline hover:border-hairline rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-full h-32 object-cover rounded-lg border border-hairline mb-3"
                    />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-sm text-ink">{item.name}</h3>
                        {(item.isVegetarian || (item as any).isVeg) && (
                          <span className="p-0.5 rounded-full bg-success-tint text-success-mid border border-success-line text-[10px]" title="Vegetarian">
                            <Leaf className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-ink-mute uppercase bg-canvas-soft px-2 py-0.5 rounded-md mt-1 inline-block">
                        {item.category || 'General'}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="font-bold text-sm text-ink">
                        {hotel.currencySymbol || '$'}
                        {itemPrice}
                      </span>
                    </div>
                  </div>

                  {item.description && (
                    <p className="text-xs text-ink-mute mt-2 line-clamp-2">{item.description}</p>
                  )}

                  <div className="flex items-center gap-2 mt-3 text-[11px] text-ink-mute">
                    <Clock className="w-3.5 h-3.5 text-[#0066cc]" />
                    <span>~{item.preparationTimeMinutes || item.prepTimeMinutes || 15} mins prep</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between">
                  <button
                    onClick={() => handleToggleAvailability(item)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      item.isAvailable
                        ? 'bg-success-tint text-success-deep border border-success-line'
                        : 'bg-accent-tint text-[#004fa3] border border-accent-soft'
                    }`}
                  >
                    {item.isAvailable ? 'In Stock' : 'Out of Stock'}
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(item)}
                      title="Edit Item"
                      className="p-2 rounded-full hover:bg-canvas-soft text-ink-mute hover:text-ink"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteItem(item)}
                      title="Delete Item"
                      className="p-2 rounded-full hover:bg-accent-tint text-ink-mute hover:text-[#0066cc]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Add/Edit Item */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-hairline">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="text-base font-bold text-ink">
                {editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-full hover:bg-canvas-soft text-ink-mute"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Dish / Item Name <span className="text-[#0066cc]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Truffle Mushroom Risotto"
                  className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Category <span className="text-[#0066cc]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Starters, Mains, Desserts"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Price ({hotel.currencySymbol || '$'}) <span className="text-[#0066cc]">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="18"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ingredients and culinary notes..."
                  className="w-full bg-white border border-hairline rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-ink"
                />
              </div>

              {/* Dish photo — uploaded to hotels/{hotelId}/menu/{itemId}/image.jpg */}
              <ImageUploader
                label="Dish Photo (Optional)"
                hint="Shown to guests on the in-room dining menu."
                storagePath={editingItem ? `hotels/${hotel.id}/menu/${editingItem.id}` : undefined}
                value={imageUrl}
                onUrlChange={setImageUrl}
                onFileChange={setImageFile}
                thumbClass="h-20"
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Prep Time (minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={prepTime}
                    onChange={(e) => setPrepTime(e.target.value)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
                  />
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isVegetarian}
                      onChange={(e) => setIsVegetarian(e.target.checked)}
                      className="w-4 h-4 rounded text-[#0066cc] focus:ring-[#0066cc]"
                    />
                    <span className="text-xs font-medium text-ink">Vegetarian Dish</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-hairline text-xs font-semibold text-ink-mute"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
