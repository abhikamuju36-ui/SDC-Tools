/**
 * CategoryList.jsx
 * Group of category navigation items for the sidebar.
 */
import NavItem from './NavItem';

export default function CategoryList({ categories, selectedCategories, onCategoryClick }) {
  if (!categories || categories.length === 0) return null;

  return (
    <div className="nav-group">
      <div className="nav-label">Categories</div>
      {categories.map((catObj) => {
        // Handle both simple strings and object { value, count }
        const value = typeof catObj === 'object' ? catObj.value : catObj;
        const count = typeof catObj === 'object' ? catObj.count : null;
        
        if (!value) return null;

        return (
          <NavItem
            key={value}
            label={value}
            active={selectedCategories.includes(value)}
            onClick={() => onCategoryClick(value)}
            count={count}
            icon={(props) => (
              <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12 12 20l-8-8V4h8Z"/><circle cx="8" cy="8" r="1.5"/>
              </svg>
            )}
          />
        );
      })}
    </div>
  );
}
